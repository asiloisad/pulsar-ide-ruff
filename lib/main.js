const { shell } = require("electron");
const path = require("path");
const os = require("os");
const whichSync = require("which").sync;
const { AutoLanguageClient } = require("@savetheclocktower/atom-languageclient");
const indie = require("./indie");

const PACKAGE_NAME = "ide-ruff";

function log(...args) {
  if (atom.config.get(`${PACKAGE_NAME}.debug`)) {
    console.log(`[${PACKAGE_NAME}]`, ...args);
  }
}

class RuffLanguageClient extends AutoLanguageClient {
  constructor() {
    super();
    this.processes = new Set();
    // Ruff's LSP rejects shutdown request due to strict param checking
    // Set to false to skip the shutdown request and just kill the process
    this.shutdownGracefully = false;
  }

  activate() {
    super.activate();
    this.processes = new Set();

    // Register commands
    this.commandSubscription = atom.commands.add("atom-workspace", {
      "ide-ruff:restart-server": () => this.restartServer(),
      "ide-ruff:lint-project": () => indie.runScan(),
      "ide-ruff:toggle-noqa": () => this.toggleNoqa(),
      "ide-ruff:global-pyproject": () => this.openGlobalConfig(),
    });

    // Suppress stream errors that occur during file close/server communication
    this.setupErrorSuppression();
  }

  /**
   * Set up global error handlers to suppress expected stream errors.
   * Ruff's LSP can cause EPIPE/stream errors during normal operation.
   */
  setupErrorSuppression() {
    const suppressedPatterns = [
      "EPIPE",
      "ERR_STREAM_DESTROYED",
      "Cannot call write after",
      "stream was destroyed",
    ];

    const shouldSuppress = (err) => {
      const msg = String(err?.message || err?.reason?.message || err || "");
      const code = String(err?.code || err?.reason?.code || "");
      return suppressedPatterns.some((p) => msg.includes(p) || code.includes(p));
    };

    this.errorHandler = (event) => {
      if (shouldSuppress(event.reason || event)) {
        event.preventDefault?.();
        log("Suppressed stream error:", event.reason?.message || event.message || event);
      }
    };

    window.addEventListener("unhandledrejection", this.errorHandler);
  }

  /**
   * Toggle the useNoqa setting and restart the server.
   */
  toggleNoqa() {
    const current = atom.config.get(`${PACKAGE_NAME}.lint.useNoqa`);
    atom.config.set(`${PACKAGE_NAME}.lint.useNoqa`, !current);
    log(`useNoqa toggled to: ${!current}`);
    // Only restart if server is running
    if (this.processes && this.processes.size > 0) {
      this.restartServer();
    }
  }

  /**
   * Get the default Ruff configuration file path for the current platform.
   * @returns {string|undefined}
   */
  getDefaultConfigPath() {
    const platform = os.platform();
    if (platform === "win32") {
      return path.join(os.homedir(), "AppData", "Roaming", "ruff", "pyproject.toml");
    } else if (platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support", "ruff", "pyproject.toml");
    } else {
      // Linux and others: XDG_CONFIG_HOME or ~/.config
      const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
      return path.join(xdgConfig, "ruff", "pyproject.toml");
    }
  }

  /**
   * Open the global Ruff configuration file.
   */
  openGlobalConfig() {
    const configPath = this.getDefaultConfigPath();
    if (configPath) {
      atom.workspace.open(configPath);
    }
  }

  /**
   * Restart the Ruff language server to apply new settings.
   */
  async restartServer() {
    log("Restarting Ruff server...");
    atom.notifications.addInfo("Restarting Ruff server...");

    try {
      // Restart all servers - this method is provided by AutoLanguageClient
      await this.restartAllServers();
      atom.notifications.addSuccess("Ruff server restarted.");
      log("Ruff server restarted successfully.");
    } catch (err) {
      log("Restart error:", err.message);
      atom.notifications.addError("Failed to restart Ruff server.", {
        description: err.message,
      });
    }
  }

  getPackageName() {
    return PACKAGE_NAME;
  }

  getGrammarScopes() {
    return ["source.python", "python"];
  }

  getLanguageName() {
    return "Python";
  }

  getServerName() {
    return "ruff";
  }

  getRootConfigurationKey() {
    return PACKAGE_NAME;
  }

  /**
   * Intercept diagnostics to include rule code in message.
   * Format: "E501 — Line too long" (matches linter-ruff style)
   */
  preInitialization(connection) {
    // Wrap onPublishDiagnostics to modify diagnostics before other handlers
    const originalOn = connection.onPublishDiagnostics.bind(connection);
    connection.onPublishDiagnostics = (callback) => {
      return originalOn((params) => {
        if (params.diagnostics) {
          for (const diag of params.diagnostics) {
            if (diag.code && !diag.message.startsWith(`${diag.code} — `)) {
              diag.message = `${diag.code} — ${diag.message}`;
            }
          }
        }
        callback(params);
      });
    };
  }

  /**
   * Override to add initializationOptions for Ruff.
   * Ruff reads settings from initializationOptions at startup.
   */
  getInitializeParams(projectPath, lsProcess) {
    const params = super.getInitializeParams(projectPath, lsProcess);
    params.initializationOptions = {
      settings: this.buildRuffSettings(),
    };
    log("InitializationOptions:", params.initializationOptions);
    return params;
  }

  /**
   * Build Ruff settings object from Atom config.
   */
  buildRuffSettings() {
    const config = atom.config.get(PACKAGE_NAME) || {};
    const ruffConfig = {};

    // Configuration file path
    if (config.configuration) {
      ruffConfig.configuration = config.configuration;
    }

    // Line length (0 means use config file)
    if (config.lineLength && config.lineLength > 0) {
      ruffConfig.lineLength = config.lineLength;
    }

    // Target Python version
    if (config.targetVersion) {
      ruffConfig.targetVersion = config.targetVersion;
    }

    // Exclude patterns
    if (config.exclude && config.exclude.length > 0) {
      ruffConfig.exclude = config.exclude;
    }

    // Lint settings
    if (config.lint) {
      ruffConfig.lint = {};
      if (typeof config.lint.enable === "boolean") {
        ruffConfig.lint.enable = config.lint.enable;
      }
      if (config.lint.preview === true) {
        ruffConfig.lint.preview = true;
      }
      if (config.lint.useNoqa === false) {
        ruffConfig.lint.ignoreNoqa = true;
      }
      if (config.lint.select && config.lint.select.length > 0) {
        ruffConfig.lint.select = config.lint.select;
      }
      if (config.lint.ignore && config.lint.ignore.length > 0) {
        ruffConfig.lint.ignore = config.lint.ignore;
      }
      if (config.lint.extendSelect && config.lint.extendSelect.length > 0) {
        ruffConfig.lint.extendSelect = config.lint.extendSelect;
      }
      if (config.lint.extendIgnore && config.lint.extendIgnore.length > 0) {
        ruffConfig.lint.extendIgnore = config.lint.extendIgnore;
      }
      if (config.lint.fixable && config.lint.fixable.length > 0) {
        ruffConfig.lint.fixable = config.lint.fixable;
      }
      if (config.lint.unfixable && config.lint.unfixable.length > 0) {
        ruffConfig.lint.unfixable = config.lint.unfixable;
      }
      if (config.lint.syntax === false) {
        ruffConfig.showSyntaxErrors = false;
      }
    }

    // Format settings
    if (config.format) {
      ruffConfig.format = ruffConfig.format || {};
      if (config.format.preview === true) {
        ruffConfig.format.preview = true;
      }
      if (config.format.indentStyle) {
        ruffConfig.format.indentStyle = config.format.indentStyle;
      }
      if (config.format.indentWidth && config.format.indentWidth > 0) {
        ruffConfig.format.indentWidth = config.format.indentWidth;
      }
      if (config.format.quoteStyle) {
        ruffConfig.format.quoteStyle = config.format.quoteStyle;
      }
    }

    // Code action settings
    if (config.codeAction) {
      ruffConfig.codeAction = {};
      if (config.codeAction.fixViolation?.enable === false) {
        ruffConfig.codeAction.fixViolation = { enable: false };
      }
      if (config.codeAction.disableRuleComment?.enable === false) {
        ruffConfig.codeAction.disableRuleComment = { enable: false };
      }
    }

    // Top-level boolean settings
    if (config.organizeImports === false) {
      ruffConfig.organizeImports = false;
    }
    if (config.fixAll === false) {
      ruffConfig.fixAll = false;
    }
    return ruffConfig;
  }

  /**
   * Transform Atom config to Ruff LSP settings format.
   * Called when server requests workspace/configuration.
   */
  mapConfigurationObject() {
    const ruffConfig = this.buildRuffSettings();
    log("mapConfigurationObject:", ruffConfig);
    return { ruff: ruffConfig };
  }

  /**
   * Consumes the indie linter service for LSP and project-wide scanning.
   * @param {Function} registerIndie - Registration function from linter-bundle
   */
  consumeLinterV2(registerIndie) {
    // Let atom-languageclient handle LSP diagnostics
    const lspDelegate = super.consumeLinterV2(registerIndie);

    // Register separate delegate for project-wide scanning
    const projectDelegate = registerIndie({ name: "Ruff/Project", deleteOnOpen: true });
    this.indieDelegate = projectDelegate;
    indie.register(projectDelegate);

    return lspDelegate;
  }

  startServerProcess(projectPath) {
    let ruffBin = atom.config.get(`${PACKAGE_NAME}.ruffExecutable`) || "ruff";

    // Check if ruff exists
    const ruffPath = whichSync(ruffBin, { nothrow: true });
    if (!ruffPath) {
      log(`Ruff not found: ${ruffBin}`);
      this.ruffBin = ruffBin;
      this.ruffFound = false;
      return null;
    }

    log(`Project: ${projectPath}`);
    log(`Ruff found: ${ruffPath}`);

    this.ruffBin = ruffPath;
    this.ruffFound = true;
    indie.setRuffPath(ruffPath);

    const childProcess = super.spawn(ruffPath, ["server"], {
      cwd: projectPath,
    });

    // Track process for cleanup
    if (childProcess) {
      this.processes.add(childProcess);
      childProcess.on("exit", () => this.processes.delete(childProcess));
    }

    return childProcess;
  }

  onSpawnError(err) {
    // Silent if ruff was never found
    if (!this.ruffFound) return;

    const description =
      err.code === "ENOENT"
        ? `ruff executable not found at \`${this.ruffBin}\`.`
        : `Could not spawn ruff at \`${this.ruffBin}\`.`;

    atom.notifications.addError("`ide-ruff` could not start ruff.", {
      dismissable: true,
      description: `${description}<p>Install ruff and ensure it's in your PATH, or set the executable path in settings.</p>`,
    });
  }

  onSpawnClose(code, signal) {
    // Silent if ruff was never found
    if (!this.ruffFound) return;

    if (code !== 0 && signal === null) {
      atom.notifications.addError("ruff language server stopped unexpectedly.", {
        dismissable: true,
        buttons: [
          {
            text: "Install Instructions",
            onDidClick: () => shell.openExternal("https://docs.astral.sh/ruff/installation/"),
          },
        ],
        description:
          "Make sure ruff is installed. You can install it via:\n" +
          "```\n" +
          "pip install ruff\n" +
          "# or\n" +
          "pipx install ruff\n" +
          "# or\n" +
          "brew install ruff\n" +
          "```",
      });
    }
  }

  async deactivate() {
    // Dispose command subscription
    if (this.commandSubscription) {
      this.commandSubscription.dispose();
    }

    // Dispose indie delegate
    if (this.indieDelegate) {
      this.indieDelegate.dispose();
      this.indieDelegate = null;
    }
    indie.dispose();

    try {
      await Promise.race([
        super.deactivate(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      log("Deactivate error (ignored):", err.message);
    }

    this.processes.clear();

    // Remove error handler after a delay to catch async cleanup errors
    setTimeout(() => {
      if (this.errorHandler) {
        window.removeEventListener("unhandledrejection", this.errorHandler);
        this.errorHandler = null;
      }
    }, 500);
  }
}

module.exports = new RuffLanguageClient();
