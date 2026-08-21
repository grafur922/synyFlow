import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { refreshMicoapiServiceToken } from './xiaomi-auth.mjs';

const CONFIG_NAMES = ['MI_USER_ID', 'C_USER_ID', 'PASS_TOKEN'];

function readConfig(runtimeConfig) {
  const values = {};
  for (const name of CONFIG_NAMES) {
    const value = runtimeConfig?.[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${name} 不能为空`);
    }
    values[name] = value.trim();
  }
  return values;
}

export async function run(runtimeConfig, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const refreshFn = dependencies.refreshFn ?? refreshMicoapiServiceToken;

  let values;
  try {
    values = readConfig(runtimeConfig);
  } catch (error) {
    stderr.write(`配置错误：${error.message}\n`);
    return 1;
  }

  try {
    const serviceToken = await refreshFn({
      miUserId: values.MI_USER_ID,
      cUserId: values.C_USER_ID,
      passToken: values.PASS_TOKEN,
    });
    if (typeof serviceToken !== 'string' || serviceToken === '') {
      throw new Error('empty service token');
    }
    stdout.write(`${serviceToken}\n`);
    return 0;
  } catch {
    stderr.write('获取 micoapi service token 失败\n');
    return 1;
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryPoint === import.meta.url) {
  const runtimeConfig = await import('../config.mjs');
  process.exitCode = await run(runtimeConfig);
}
