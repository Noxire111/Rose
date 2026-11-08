# ROSE-AutoAccept

## Description
**ROSE-AutoAccept** is a standalone plugin for Pengu Loader that automatically accepts League of Legends matches. It is designed for reliability and includes support for configurable delays, which can be adjusted interactively while in the lobby.

## Key Features
- Asynchronously waits for `window.rcp` to become available, preventing client-side loading errors.
- Securely intercepts the LCU (League Client Update) WebSocket.
- Provides a configuration interface—offering delay options of 0s, 2s, 5s, or 8s—accessible via a native-style League of Legends tooltip that appears when hovering over the button in the lobby.
