/**
 * @name ROSE-AutoAccept
 * @author Rose Team
 * @description Auto accept match queue pops for League of Legends via Pengu Loader
 */
(function initAutoAccept() {
  const LOG_PREFIX = "[ROSE-AutoAccept]";
  let acceptTimeoutId = null;
  let tooltipEl = null;
  let hideTooltipTimeout = null;

  function log(level, message, error = null) {
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (error) {
      consoleMethod(`${LOG_PREFIX} ${message}`, error);
    } else {
      consoleMethod(`${LOG_PREFIX} ${message}`);
    }
  }

  function waitForRcp() {
    return new Promise((resolve) => {
      const check = () => {
        if (window.rcp && typeof window.rcp.postInit === "function") {
          resolve(window.rcp);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // Deep query selector to penetrate Shadow DOMs
  function findElementInShadows(selector, root = document) {
    if (!root) return null;
    
    try {
      if (root.querySelector) {
        const el = root.querySelector(selector);
        if (el) return el;
      }
      
      const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of elements) {
        if (el.shadowRoot) {
          const found = findElementInShadows(selector, el.shadowRoot);
          if (found) return found;
        }
      }
    } catch (e) {
      // Ignore query errors
    }
    return null;
  }

  // Intercept Ready Check (LCU Queue Pop)
  async function interceptReadyCheckWebsocket() {
    try {
      const rcp = await waitForRcp();
      rcp.postInit("rcp-fe-lol-champ-select", (api) => {
        try {
          if (!api || !api.champSelectBinding || !api.champSelectBinding.socket || !api.champSelectBinding.socket._websocket) {
            log("warn", "Champ select websocket binding not fully available, retrying intercept...");
            setTimeout(interceptReadyCheckWebsocket, 500);
            return;
          }
          const ws = api.champSelectBinding.socket._websocket;
          const parentOnMessage = ws.onmessage;

          ws.onmessage = function (event) {
            try {
              const payload = JSON.parse(event.data);
              if (payload[1] === "OnJsonApiEvent") {
                const eventData = payload[2];
                const uri = eventData["uri"] || "";

                if (uri.includes("/lol-matchmaking/v1/ready-check")) {
                  const data = eventData["data"];
                  log("info", `Ready Check event received: uri=${uri}, state=${data?.state}, playerResponse=${data?.playerResponse}`);

                  if (data && (data["state"] === "Found" || data["state"] === "InProgress") && data["playerResponse"] !== "Accepted") {
                    const isEnabled = localStorage.getItem("nox-auto-accept") === "true";
                    log("info", `Match Found! Auto-Accept is enabled: ${isEnabled}`);

                    if (isEnabled) {
                      const delaySec = parseInt(localStorage.getItem("nox-auto-accept-delay") || "0", 10);
                      log("info", `Scheduling auto-accept in ${delaySec} seconds...`);

                      if (acceptTimeoutId) {
                        log("info", "Auto-accept already scheduled, waiting...");
                        return;
                      }

                      acceptTimeoutId = setTimeout(() => {
                        // Verify state is still Found/InProgress before sending accept
                        fetch("/lol-matchmaking/v1/ready-check")
                          .then(res => res.json())
                          .then(checkData => {
                            if (checkData && (checkData.state === "Found" || checkData.state === "InProgress") && checkData.playerResponse !== "Accepted") {
                              log("info", "Sending accept request to LCU...");
                              fetch("/lol-matchmaking/v1/ready-check/accept", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json"
                                },
                                body: "{}"
                              })
                              .then((res) => {
                                log("info", `Accept response status: ${res.status}`);
                              })
                              .catch(err => log("error", "Failed to accept match", err))
                              .finally(() => {
                                acceptTimeoutId = null;
                              });
                            } else {
                              log("info", "Ready-check state is no longer active, skipping accept.");
                              acceptTimeoutId = null;
                            }
                          })
                          .catch(err => {
                            log("error", "Failed to verify ready check state before accept", err);
                            acceptTimeoutId = null;
                          });
                      }, delaySec * 1000);
                    }
                  } else {
                    // Ready check ended or was already accepted, clear any pending timeouts
                    if (acceptTimeoutId) {
                      clearTimeout(acceptTimeoutId);
                      acceptTimeoutId = null;
                    }
                  }
                }
              }
              return parentOnMessage.call(this, event);
            } catch (e) {
              log("error", "Error parsing WebSocket message", e);
            }
          };
          log("info", "Websocket Interception for Auto-Accept successful");
        } catch (e) {
          log("error", "Failed WebSocket interception inside postInit", e);
        }
      });
    } catch (e) {
      log("error", "Failed to initialize LCU websocket hook", e);
    }
  }

  function positionTooltip(button) {
    if (!tooltipEl || !button) return;
    const rect = button.getBoundingClientRect();
    tooltipEl.style.top = `${rect.bottom + 8 + window.scrollY}px`;
    const tooltipWidth = 180;
    tooltipEl.style.left = `${rect.left + (rect.width / 2) - (tooltipWidth / 2) + window.scrollX}px`;
  }

  function updateTooltipContent() {
    if (!tooltipEl) return;
    const isActive = localStorage.getItem("nox-auto-accept") === "true";
    const currentDelay = parseInt(localStorage.getItem("nox-auto-accept-delay") || "0", 10);

    tooltipEl.innerHTML = `
      <div style="color: #f0e6d2; font-weight: bold; border-bottom: 1px solid #3c3c41; padding-bottom: 5px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; font-family: 'Beaufort for LOL', sans-serif;">
        Auto Accept Match
      </div>
      <div style="margin-bottom: 10px; font-size: 11px; display: flex; align-items: center; justify-content: space-between;">
        <span>Status:</span>
        <span style="color: ${isActive ? '#c8aa6e' : '#5c5b57'}; font-weight: bold;">
          ${isActive ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>
      <div style="color: #f0e6d2; font-size: 10px; font-weight: bold; margin-bottom: 6px; text-transform: uppercase; font-family: 'Beaufort for LOL', sans-serif;">Accept Delay:</div>
      <div style="display: flex; gap: 4px; justify-content: space-between;">
        ${[0, 2, 5, 8].map(delay => {
          const isSelected = currentDelay === delay;
          return `
            <div class="delay-opt" data-delay="${delay}" style="
              flex: 1;
              text-align: center;
              padding: 4px 0;
              border: 1px solid ${isSelected ? '#c8aa6e' : '#3c3c41'};
              background: ${isSelected ? '#1e2328' : '#010a13'};
              color: ${isSelected ? '#f0e6d2' : '#a09b8c'};
              border-radius: 2px;
              cursor: pointer;
              font-size: 11px;
              transition: all 0.15s ease;
            ">${delay}s</div>
          `;
        }).join('')}
      </div>
    `;

    // Add click listeners to delay options
    tooltipEl.querySelectorAll(".delay-opt").forEach(opt => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        const delay = parseInt(opt.getAttribute("data-delay"), 10);
        localStorage.setItem("nox-auto-accept-delay", String(delay));
        log("info", `Auto-Accept delay configured to: ${delay} seconds`);
        updateTooltipContent();
      });

      opt.addEventListener("mouseenter", () => {
        opt.style.borderColor = "#c8aa6e";
        opt.style.color = "#f0e6d2";
      });
      opt.addEventListener("mouseleave", () => {
        const delay = parseInt(opt.getAttribute("data-delay"), 10);
        const currentDelay = parseInt(localStorage.getItem("nox-auto-accept-delay") || "0", 10);
        if (currentDelay !== delay) {
          opt.style.borderColor = "#3c3c41";
          opt.style.color = "#a09b8c";
        }
      });
    });
  }

  function showTooltip(button) {
    if (hideTooltipTimeout) {
      clearTimeout(hideTooltipTimeout);
      hideTooltipTimeout = null;
    }

    if (tooltipEl) {
      updateTooltipContent();
      positionTooltip(button);
      return;
    }

    tooltipEl = document.createElement("div");
    tooltipEl.id = "nox-auto-accept-tooltip";
    
    // Style the tooltip box (League themed)
    tooltipEl.style.position = "absolute";
    tooltipEl.style.background = "#010a13";
    tooltipEl.style.border = "1px solid #785a28";
    tooltipEl.style.boxShadow = "0 0 10px rgba(0, 0, 0, 0.8)";
    tooltipEl.style.padding = "10px";
    tooltipEl.style.borderRadius = "2px";
    tooltipEl.style.zIndex = "10000";
    tooltipEl.style.fontFamily = "Arial, sans-serif";
    tooltipEl.style.fontSize = "12px";
    tooltipEl.style.color = "#a09b8c";
    tooltipEl.style.width = "180px";
    tooltipEl.style.pointerEvents = "all";
    tooltipEl.style.transition = "opacity 0.15s ease";
    tooltipEl.style.opacity = "0";

    tooltipEl.addEventListener("mouseenter", () => {
      if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
        hideTooltipTimeout = null;
      }
    });

    tooltipEl.addEventListener("mouseleave", () => {
      scheduleHideTooltip();
    });

    document.body.appendChild(tooltipEl);
    updateTooltipContent();
    positionTooltip(button);
    
    // Fade in
    tooltipEl.offsetHeight; // Force reflow
    tooltipEl.style.opacity = "1";
  }

  function scheduleHideTooltip() {
    if (hideTooltipTimeout) clearTimeout(hideTooltipTimeout);
    hideTooltipTimeout = setTimeout(() => {
      if (tooltipEl) {
        tooltipEl.style.opacity = "0";
        const elToRemove = tooltipEl;
        tooltipEl = null;
        setTimeout(() => {
          if (elToRemove && elToRemove.parentNode) {
            elToRemove.parentNode.removeChild(elToRemove);
          }
        }, 150);
      }
    }, 200);
  }

  // Create Auto-Accept toggle button in the Lobby Top-Right Bar
  function createLobbyToggle() {
    if (document.getElementById("nox-auto-accept-lobby-btn")) {
      return;
    }

    const selectors = [
      ".custom-member-dir",
      ".parties-header-actions",
      ".parties-navigation",
      ".lobby-header-actions",
      ".lobby-header-buttons-container"
    ];

    let container = null;
    for (const selector of selectors) {
      container = findElementInShadows(selector);
      if (container) {
        break;
      }
    }
    
    if (!container) {
      return;
    }

    const button = document.createElement("div");
    button.id = "nox-auto-accept-lobby-btn";
    button.className = "nox-auto-accept-button";
    
    // Style it like a circular League of Legends UI button
    button.style.width = "28px";
    button.style.height = "28px";
    button.style.borderRadius = "50%";
    button.style.border = "2px solid #5c5b57";
    button.style.cursor = "pointer";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.marginLeft = "6px";
    button.style.marginRight = "6px";
    button.style.transition = "all 0.2s ease";
    button.style.position = "relative";
    button.style.background = "rgba(1, 10, 19, 0.8)";
    button.style.zIndex = "999";

    const updateButtonVisual = () => {
      const isActive = localStorage.getItem("nox-auto-accept") === "true";
      if (isActive) {
        button.style.borderColor = "#c8aa6e";
        button.style.boxShadow = "0 0 8px rgba(200, 170, 110, 0.6)";
        button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c8aa6e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      } else {
        button.style.borderColor = "#5c5b57";
        button.style.boxShadow = "none";
        button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5c5b57" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
      }
    };

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = localStorage.getItem("nox-auto-accept") === "true";
      const nextState = !current;
      localStorage.setItem("nox-auto-accept", nextState ? "true" : "false");
      log("info", `Auto-Accept button clicked. Toggled to: ${nextState ? "ON" : "OFF"}`);
      updateButtonVisual();
      if (tooltipEl) {
        updateTooltipContent();
      }
    });

    button.addEventListener("mouseenter", () => {
      const isActive = localStorage.getItem("nox-auto-accept") === "true";
      button.style.borderColor = isActive ? "#f0e6d2" : "#a09b8c";
      showTooltip(button);
    });
    button.addEventListener("mouseleave", () => {
      const isActive = localStorage.getItem("nox-auto-accept") === "true";
      button.style.borderColor = isActive ? "#c8aa6e" : "#5c5b57";
      scheduleHideTooltip();
    });

    updateButtonVisual();

    if (container.firstChild) {
      container.insertBefore(button, container.firstChild);
    } else {
      container.appendChild(button);
    }
  }

  function startLobbyObserver() {
    const observer = new MutationObserver(() => {
      createLobbyToggle();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    interceptReadyCheckWebsocket().catch(err => log("error", "Failed websocket hook", err));
    createLobbyToggle();
    startLobbyObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
