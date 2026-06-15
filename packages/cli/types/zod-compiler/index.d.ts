declare module 'zod-compiler' {
  import type { ZodType, output } from 'zod';

  interface CompiledSchema<T> {
    parse(input: unknown): T;
    parseAsync(input: unknown): Promise<T>;
    safeParse(input: unknown): SafeParseResult<T>;
    safeParseAsync(input: unknown): Promise<SafeParseResult<T>>;
    is(input: unknown): input is T;
  }

  interface SafeParseSuccess<T> {
    success: true;
    data: T;
  }

  interface SafeParseError {
    success: false;
    error: {
      issues: { code: string; path: (string | number)[]; message: string; [key: string]: unknown }[];
    };
  }

  type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

  function compile<T extends ZodType>(zodSchema: T): T & CompiledSchema<output<T>>;
  function isCompiledSchema(value: unknown): value is CompiledSchema<unknown>;
}
