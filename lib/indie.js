const { execFile } = require("child_process");

const PACKAGE_NAME = "ide-ruff";

function log(...args) {
  if (atom.config.get(`${PACKAGE_NAME}.debug`)) {
    console.log(`[${PACKAGE_NAME}]`, ...args);
  }
}

/**
 * Project-wide Ruff linter using the indie linter API.
 * Scans all project files from disk via ruff check and reports
 * results through the linter-bundle IndieDelegate.
 */
class ProjectLinter {
  constructor() {
    this.indieDelegate = null;
    this.scanning = false;
    /** @type {string} Path to ruff executable */
    this.ruffBin = "ruff";
  }

  /**
   * Store the IndieDelegate obtained from linter-bundle.
   * @param {IndieDelegate} delegate
   */
  register(delegate) {
    this.indieDelegate = delegate;
  }

  /**
   * Set the ruff executable path.
   * @param {string} ruffPath
   */
  setRuffPath(ruffPath) {
    this.ruffBin = ruffPath;
  }

  /**
   * Build args for ruff check based on ide-ruff config.
   * @returns {string[]}
   */
  buildCheckArgs() {
    const config = atom.config.get(PACKAGE_NAME) || {};
    const args = [];

    // Configuration file
    if (config.configuration) {
      args.push(`--config=${config.configuration}`);
    }

    // Line length
    if (config.lineLength && config.lineLength > 0) {
      args.push(`--line-length=${config.lineLength}`);
    }

    // Target Python version
    if (config.targetVersion) {
      args.push(`--target-version=${config.targetVersion}`);
    }

    // Exclude patterns
    if (config.exclude && config.exclude.length > 0) {
      for (const pattern of config.exclude) {
        args.push(`--exclude=${pattern}`);
      }
    }

    // Lint settings
    if (config.lint) {
      if (config.lint.preview === true) {
        args.push("--preview");
      }
      if (config.lint.useNoqa === false) {
        args.push("--ignore-noqa");
      }
      if (config.lint.select && config.lint.select.length > 0) {
        args.push(`--select=${config.lint.select.join(",")}`);
      }
      if (config.lint.ignore && config.lint.ignore.length > 0) {
        args.push(`--ignore=${config.lint.ignore.join(",")}`);
      }
      if (config.lint.extendSelect && config.lint.extendSelect.length > 0) {
        args.push(`--extend-select=${config.lint.extendSelect.join(",")}`);
      }
      if (config.lint.extendIgnore && config.lint.extendIgnore.length > 0) {
        args.push(`--extend-ignore=${config.lint.extendIgnore.join(",")}`);
      }
      if (config.lint.fixable && config.lint.fixable.length > 0) {
        args.push(`--fixable=${config.lint.fixable.join(",")}`);
      }
      if (config.lint.unfixable && config.lint.unfixable.length > 0) {
        args.push(`--unfixable=${config.lint.unfixable.join(",")}`);
      }
    }

    return args;
  }

  /**
   * Run ruff check on a project path and return parsed JSON results.
   * @param {string} projectPath
   * @returns {Promise<Array>}
   */
  execRuff(projectPath) {
    return new Promise((resolve) => {
      const args = [
        "check",
        "--quiet",
        "--output-format=json",
        ...this.buildCheckArgs(),
        projectPath,
      ];

      log("Project scan args:", args);

      const opts = {
        timeout: 10 * 1e4,
        cwd: projectPath,
        maxBuffer: 1024 * 1024 * 100,
      };

      execFile(this.ruffBin, args, opts, (error, stdout, stderr) => {
        if (stderr) {
          console.error(`[${PACKAGE_NAME}] Project scan stderr:`, stderr);
          resolve([]);
          return;
        }
        if (!stdout || !stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          console.error(`[${PACKAGE_NAME}] Project scan JSON parse error:`, err);
          resolve([]);
        }
      });
    });
  }

  /**
   * Convert a ruff JSON diagnostic to a linter message.
   * @param {string} filePath
   * @param {Object} item - Ruff diagnostic object
   * @returns {Object|null} Linter message or null if item should be skipped
   */
  convertMessage(filePath, item) {
    if (!item.location) return null;

    // Syntax errors (E999 or null code)
    const isSyntaxError = item.code === null || item.code === "E999";

    // Skip syntax errors if disabled
    const showSyntax = atom.config.get(`${PACKAGE_NAME}.lint.syntax`);
    if (showSyntax === false && isSyntaxError) {
      return null;
    }

    return {
      severity: isSyntaxError ? "error" : "warning",
      excerpt: item.code
        ? `${item.code} — ${item.message}`
        : item.message,
      location: {
        file: filePath,
        position: [
          [item.location.row - 1, item.location.column - 1],
          [item.end_location.row - 1, item.end_location.column - 1],
        ],
      },
    };
  }

  /**
   * Run the project-wide ruff scan.
   */
  async runScan() {
    if (!this.indieDelegate || this.scanning) {
      return;
    }

    this.scanning = true;
    log("Starting project scan...");

    const projectPaths = atom.project.getPaths();
    if (!projectPaths.length) {
      this.scanning = false;
      return;
    }

    const allMessages = [];

    try {
      for (const projectPath of projectPaths) {
        log("Scanning:", projectPath);
        const items = await this.execRuff(projectPath);

        for (const item of items) {
          const filePath = item.filename;
          if (!filePath) continue;

          const msg = this.convertMessage(filePath, item);
          if (msg) allMessages.push(msg);
        }
      }

      this.indieDelegate.setAllMessages(allMessages, { showProjectView: true });
      log(`Project scan complete: ${allMessages.length} issues found`);
    } catch (error) {
      console.error(`[${PACKAGE_NAME}] Project scan failed:`, error);
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Clear all project-wide messages.
   */
  clearMessages() {
    if (this.indieDelegate) {
      this.indieDelegate.clearMessages();
    }
  }

  /**
   * Dispose all resources.
   */
  dispose() {
    this.indieDelegate = null;
  }
}

module.exports = new ProjectLinter();
