/**
 * VS Code Extension Test Runner
 * Downloads VS Code, installs the extension, and runs tests
 */

import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Use a stable version known to work
    const vscodeVersion = '1.85.0';

    // Download VS Code
    const vscodeExecutablePath = await downloadAndUnzipVSCode(vscodeVersion);

    console.log('Extension path:', extensionDevelopmentPath);
    console.log('Tests path:', extensionTestsPath);
    console.log('VS Code path:', vscodeExecutablePath);

    // Run tests
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--verbose'],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
