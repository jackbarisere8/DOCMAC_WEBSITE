/**
 * Ambient type definitions for Node.js 24 and Edge Worker runtime
 * Resolves standard built-in modules without external dependencies
 */

declare module 'node:test' {
  export interface TestContext {
    diagnostic(message: string): void;
    test(name: string, fn?: (t: TestContext) => any): Promise<void> | void;
    runOnly(value?: boolean): void;
    skip(message?: string): void;
    todo(message?: string): void;
  }
  export function test(name: string, fn?: (t: TestContext) => any): Promise<void> | void;
  export function describe(name: string, fn?: () => any): Promise<void> | void;
  export function before(fn: () => any): void;
  export function beforeEach(fn: () => any): void;
  export function after(fn: () => any): void;
  export function afterEach(fn: () => any): void;
  export default test;
}

declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): any[];
      get(...params: unknown[]): any;
      run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    };
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string | Buffer | URL, options?: any): any;
  export function writeFileSync(path: string | Buffer | URL, data: any, options?: any): void;
  export function appendFileSync(path: string | Buffer | URL, data: any, options?: any): void;
  export function existsSync(path: string | Buffer | URL): boolean;
  export function readdirSync(path: string | Buffer | URL, options?: any): any[];
  export function statSync(path: string | Buffer | URL): any;
  export function unlinkSync(path: string | Buffer | URL): void;
  export function mkdirSync(path: string | Buffer | URL, options?: any): any;
}

declare module 'node:fs/promises' {
  export function readFile(path: string | Buffer | URL, options?: any): Promise<any>;
  export function writeFile(path: string | Buffer | URL, data: any, options?: any): Promise<void>;
  export function readdir(path: string | Buffer | URL, options?: any): Promise<string[]>;
  export function stat(path: string | Buffer | URL): Promise<any>;
  export function unlink(path: string | Buffer | URL): Promise<void>;
  export function mkdir(path: string | Buffer | URL, options?: any): Promise<any>;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: any): Hash;
    digest(encoding?: string): any;
  }
  export function createHash(algorithm: string): Hash;
  export function randomBytes(size: number): Buffer;
  export function timingSafeEqual(a: Buffer, b: Buffer): boolean;
}

declare module 'node:perf_hooks' {
  export const performance: {
    now(): number;
  };
}

