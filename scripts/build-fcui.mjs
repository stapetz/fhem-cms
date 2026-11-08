import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const check = process.argv.slice(2);
if (check.length > 1 || (check.length === 1 && check[0] !== '--check')) {
  throw new Error('Usage: node scripts/build-fcui.mjs [--check]');
}

const common = {
  bundle: true,
  minify: true,
  target: ['es2020'],
  legalComments: 'inline',
  write: false,
  metafile: true,
};
const builds = [
  {
    ...common,
    entryPoints: ['fcui/runtime.js'],
    format: 'esm',
    outfile: 'www/fhem-cms/js/fcui-runtime.js',
  },
  {
    ...common,
    entryPoints: ['node_modules/gridstack/dist/gridstack.min.css'],
    outfile: 'www/fhem-cms/css/fcui-gridstack.css',
  },
];

const packages = new Set();
const outputs = [];
for (const options of builds) {
  const result = await build(options);
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(match[1]);
  }
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.some((item) =>
      item.external && !(item.kind === 'url-token' && item.path.startsWith('data:')))) {
      throw new Error(`External dependency in ${options.outfile}`);
    }
  }
  outputs.push(...result.outputFiles);
}

const notices = [];
for (const name of [...packages].sort()) {
  const dir = resolve('node_modules', name);
  const manifest = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
  if (!['MIT', 'BSD-3-Clause'].includes(manifest.license)) {
    throw new Error(`Review unsupported license for ${name}: ${manifest.license}`);
  }
  const license = await readFile(resolve(dir, 'LICENSE'), 'utf8');
  notices.push(`${name} ${manifest.version} (${manifest.license})\n\n${license.trim()}`);
}
outputs.push({
  path: resolve('www/fhem-cms/FCUI-LICENSES.txt'),
  contents: Buffer.from(`${notices.join('\n\n--------------------\n\n')}\n`),
});

for (const output of outputs) {
  if (check.length) {
    const current = await readFile(output.path);
    if (!current.equals(output.contents)) {
      throw new Error(`Generated asset is out of date: ${output.path}`);
    }
  } else {
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.contents);
  }
}
