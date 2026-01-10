/**
 * Unit tests for Ender validators
 */

import { expect } from 'chai';
import {
  SyntaxValidator,
  BestPracticesValidator,
  SecurityScannerValidator,
  ApiExistenceValidator,
  type ValidatorContext
} from '../../src/validators';
import type { FileChange } from '../../src/types';

describe('Validators', () => {
  const createContext = (changes: FileChange[]): ValidatorContext => ({
    changes,
    existingFiles: new Map(),
    projectPath: '/test/project',
    config: {}
  });

  describe('SyntaxValidator', () => {
    const validator = new SyntaxValidator();

    it('should pass for valid TypeScript', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: `
          const hello = (name: string): string => {
            return \`Hello, \${name}!\`;
          };
        `,
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.passed).to.be.true;
    });

    it('should detect unmatched brackets', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: `
          function broken() {
            if (true) {
              console.log("missing closing");
          }
        `,
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.passed).to.be.false;
      expect(result.issues.some(i => i.code === 'SYNTAX_UNCLOSED_BRACKET')).to.be.true;
    });

    it('should validate JSON files', async () => {
      const context = createContext([{
        path: 'config.json',
        content: '{ "valid": true }',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.passed).to.be.true;
    });

    it('should detect invalid JSON', async () => {
      const context = createContext([{
        path: 'config.json',
        content: '{ invalid: true }',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.passed).to.be.false;
      expect(result.issues.some(i => i.code === 'SYNTAX_INVALID_JSON')).to.be.true;
    });
  });

  describe('BestPracticesValidator', () => {
    const validator = new BestPracticesValidator();

    it('should warn about console.log', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: 'console.log("debug");',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'BP_CONSOLE_STATEMENT')).to.be.true;
    });

    it('should error on debugger statement', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: `
          function test() {
            debugger;
            return true;
          }
        `,
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'BP_DEBUGGER_STATEMENT')).to.be.true;
    });

    it('should warn about var usage', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: 'var oldStyle = true;',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'BP_VAR_USAGE')).to.be.true;
    });

    it('should warn about any type in TypeScript', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: 'function process(data: any): any { return data; }',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'BP_ANY_TYPE')).to.be.true;
    });
  });

  describe('SecurityScannerValidator', () => {
    const validator = new SecurityScannerValidator();

    it('should detect hardcoded API keys', async () => {
      const context = createContext([{
        path: 'config.ts',
        content: 'const apiKey = "sk-live-abcdefghijklmnopqrstuvwxyz";',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'SEC_HARDCODED_SECRET')).to.be.true;
    });

    it('should allow environment variable references', async () => {
      const context = createContext([{
        path: 'config.ts',
        content: 'const apiKey = process.env.API_KEY;',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'SEC_HARDCODED_SECRET')).to.be.false;
    });

    it('should detect potential SQL injection', async () => {
      const context = createContext([{
        path: 'db.ts',
        content: 'const query = `SELECT * FROM users WHERE id = ${userId}`;',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'SEC_SQL_INJECTION')).to.be.true;
    });

    it('should warn about eval usage', async () => {
      const context = createContext([{
        path: 'dynamic.ts',
        content: 'eval(userInput);',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'SEC_EVAL')).to.be.true;
    });
  });

  describe('ApiExistenceValidator', () => {
    const validator = new ApiExistenceValidator();

    it('should detect hallucinated array methods', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: 'const hasItem = array.contains("item");',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'API_HALLUCINATED')).to.be.true;
    });

    it('should detect hallucinated fs methods', async () => {
      const context = createContext([{
        path: 'file.ts',
        content: 'const data = fs.readFilePromise("file.txt");',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'API_HALLUCINATED')).to.be.true;
      expect(result.issues[0]?.suggestion).to.include('fs.promises.readFile');
    });

    it('should allow valid array methods', async () => {
      const context = createContext([{
        path: 'test.ts',
        content: 'const hasItem = array.includes("item");',
        operation: 'create'
      }]);

      const result = await validator.run(context);
      expect(result.issues.some(i => i.code === 'API_HALLUCINATED')).to.be.false;
    });
  });
});
