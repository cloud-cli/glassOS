const statusElement = document.getElementById("backend-status");
const hostnameButton = document.getElementById("hostname-button");
const hostnameResult = document.getElementById("hostname-result");
const maximizeButton = document.querySelector(".maximize");

const windowControls = window.glassOS;
const setMaximizeLabel = (isMaximized) => {
  maximizeButton.setAttribute("aria-label", isMaximized ? "Restore" : "Maximize");
  maximizeButton.title = isMaximized ? "Restore" : "Maximize";
};

windowControls.isMaximized().then(setMaximizeLabel);
windowControls.onMaximizedChange(setMaximizeLabel);
document.querySelector(".close").addEventListener("click", windowControls.closeWindow);
document.querySelector(".minimize").addEventListener("click", windowControls.minimizeWindow);
maximizeButton.addEventListener("click", windowControls.toggleMaximize);

let socket;
let retryTimer;
let isUnloading = false;

function setBackendStatus(state, message) {
  statusElement.dataset.state = state;
  statusElement.textContent = message;
  hostnameButton.disabled = state !== "connected";
}

function connectBackend() {
  socket = new WebSocket("ws://127.0.0.1:8080");

  socket.addEventListener("open", async () => {
    const token = await windowControls.getBackendToken();
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "authorization",
        method: "authenticate",
        params: { token },
      }),
    );
  });
  socket.addEventListener("close", () => {
    if (isUnloading) {
      return;
    }

    setBackendStatus("disconnected", "Local backend unavailable; reconnecting…");
    retryTimer = window.setTimeout(connectBackend, 1500);
  });
  socket.addEventListener("error", () => socket.close());
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id === "authorization") {
      setBackendStatus("connected", "Local backend connected");
      return;
    }

    if (message.id !== "hostname") {
      return;
    }

    hostnameResult.textContent = message.error
      ? `Request failed: ${message.error.message}`
      : `This device is ${message.result.contents.trim()}`;
  });
}

hostnameButton.addEventListener("click", () => {
  hostnameResult.textContent = "Reading hostname…";
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "hostname",
      method: "readFile",
      params: { path: "/etc/hostname" },
    }),
  );
});

window.addEventListener("beforeunload", () => {
  isUnloading = true;
  window.clearTimeout(retryTimer);
  socket?.close();
});

connectBackend();
