const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererPath = path.join(__dirname, "index.html");
const rendererUrl = pathToFileURL(rendererPath).href;
const backendToken = randomBytes(32).toString("hex");
let backendProcess;
const smokeTest = process.argv.includes("--smoke-test");

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function runSmokeTest(window) {
  const deadline = Date.now() + 10000;
  let backendConnected = false;
  while (Date.now() < deadline) {
    backendConnected = await window.webContents.executeJavaScript(
      "document.querySelector('#backend-status')?.dataset.state === 'connected'",
    );
    if (backendConnected) {
      break;
    }

    await delay(100);
  }

  if (!backendConnected) {
    throw new Error("Renderer did not connect to the backend");
  }

  const hostname = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#hostname-button');
    button.click();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const poll = () => {
        const result = document.querySelector('#hostname-result').textContent;
        if (result.startsWith('This device is ')) {
          resolve(result);
        } else if (result.startsWith('Request failed:') || Date.now() >= deadline) {
          reject(new Error(result || 'Hostname request timed out'));
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    });
  })()`);

  console.log(`GlassOS smoke test passed: ${hostname}`);
  app.quit();
}

function getTrustedWindow(event) {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== rendererUrl) {
    return null;
  }

  return BrowserWindow.fromWebContents(event.sender);
}

function registerWindowControls() {
  ipcMain.on("glassos:window:close", (event) => {
    getTrustedWindow(event)?.close();
  });

  ipcMain.on("glassos:window:minimize", (event) => {
    getTrustedWindow(event)?.minimize();
  });

  ipcMain.on("glassos:window:toggle-maximize", (event) => {
    const window = getTrustedWindow(event);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle("glassos:window:is-maximized", (event) => {
    return getTrustedWindow(event)?.isMaximized() ?? false;
  });

  ipcMain.handle("glassos:backend:token", (event) => {
    return getTrustedWindow(event) ? backendToken : null;
  });
}

function startBackend() {
  const backendPath = path.join(__dirname, "..", "backend", "server.js");
  backendProcess = utilityProcess.fork(backendPath, [], {
    serviceName: "GlassOS system backend",
  });
  backendProcess.once("spawn", () => {
    backendProcess.postMessage({ port: 8080, token: backendToken });
  });
  backendProcess.on("error", (error) => {
    console.error("Unable to start the GlassOS backend:", error);
  });
  backendProcess.on("exit", (code) => {
    if (!app.isQuitting) {
      console.error(`GlassOS backend stopped with exit code ${code}`);
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1024,
    height: 720,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
    }
  });
  window.loadFile(rendererPath);
  if (smokeTest) {
    window.webContents.once("did-finish-load", () => {
      runSmokeTest(window).catch((error) => {
        console.error("GlassOS smoke test failed:", error);
        app.exit(1);
      });
    });
  }
  window.on("maximize", () => window.webContents.send("glassos:window:maximized", true));
  window.on("unmaximize", () => window.webContents.send("glassos:window:maximized", false));
}

app.commandLine.appendSwitch("ozone-platform-hint", "auto");

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(() => {
    registerWindowControls();
    startBackend();
    createWindow();
  });
} else {
  app.quit();
}

app.on("before-quit", () => {
  app.isQuitting = true;
  backendProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
