import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export function renderInstaller(templatePath, version = '') {
  const template = fs.readFileSync(templatePath, 'utf8');
  const marker = '@OFFLINE_PLUGIN_HOST_CODE@';
  if (template.split(marker).length !== 2) throw new Error('Expected one plugin host code marker');
  const helper = fs.readFileSync(new URL('./rebind-plugin-host.mjs', import.meta.url), 'utf8');
  return template.replaceAll('@DSH_VERSION@', version).replace(marker, () => helper.trimEnd());
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [template, output, version] = process.argv.slice(2);
  if (!template || !output) throw new Error('Usage: node render-installer.mjs TEMPLATE OUTPUT [VERSION]');
  fs.writeFileSync(output, renderInstaller(template, version), { mode: 0o755 });
}
