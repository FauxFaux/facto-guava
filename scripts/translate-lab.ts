#!/usr/bin/env -S tsx

import { copyFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pascalSnakeCase } from 'change-case';
import { type ModData } from 'factoriolab/src/app/models';
import { readFileSync } from 'fs';
import * as babelParser from '@babel/parser';
import {
  type ExportNamedDeclaration,
  type ObjectExpression,
  type VariableDeclaration,
} from '@babel/types';

async function main() {
  const avail = ridiculouslyLoadLab();
  console.log(avail);
}

function ridiculouslyLoadLab() {
  const require = createRequire(import.meta.url);
  const dataPath = require.resolve('factoriolab/src/data');
  const src = readFileSync(dataPath, { encoding: 'utf-8' });
  const ast = babelParser.parse(src, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const exports = ast.program.body.filter(isExportNamedDeclaration);
  const exportedVars = exports
    .map((v) => v.declaration)
    .filter((v) => isVariableDeclaration(v))
    .map((v) => v?.declarations?.[0]);
  // and I gave up on types again
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = exportedVars.find((v) => v?.id?.name === 'data')!;
  const mods = data.init.properties[0];

  const available: { id: string; name: string; game: string }[] = [];

  for (const { properties } of mods.value.elements as ObjectExpression[]) {
    const id = properties.find((p) => p.key.name === 'id')?.value.value;
    const name = properties.find((p) => p.key.name === 'name')?.value.value;
    const game = properties.find((p) => p.key.name === 'game')?.value.property
      .name;
    available.push({ id, name, game });
  }

  return available;
}

async function legacy() {
  const fromLab = Object.entries(toLab).reduce(
    (acc, [id, labId]) => {
      if (!labId) return acc;
      if (!acc[labId]) acc[labId] = [];
      acc[labId].push(id as DataSetId);
      return acc;
    },
    {} as Record<string, DataSetId[]>,
  );

  const labIds = new Set(Object.values(toLab).filter((id) => id));
  for (const labId of labIds) {
    if (!labId) continue;
    const lab: ModData = (
      await import(`factoriolab/src/data/${labId}/data.json`)
    ).default;

    const ourItems = new Set<string>();
    for (const ds of fromLab[labId]) {
      const us = await loadProcMgmt(ds);
      for (const item of Object.keys(us.items)) {
        ourItems.add(item);
      }
    }

    const ourProcs = new Set<string>();
    for (const ds of fromLab[labId]) {
      const us = await loadProcMgmt(ds);
      for (const proc of Object.keys(us.processes)) {
        ourProcs.add(proc);
      }
    }

    const items: Record<string, LabItem> = {};
    const procs: Record<string, LabProcess> = {};

    let convertId = (id: string) => id;
    switch (labId) {
      case 'sfy':
        convertId = (id) => id.replace(/-/g, '_');
        break;
      case 'dsp':
        convertId = (id) => pascalSnakeCase(id);
        break;
    }

    const handleBarrels = ['bobang', 'ffw', 'pysalf'].includes(labId);
    const handleContainers = ['ffw'].includes(labId);

    for (const item of lab.items) {
      const itemId = convertId(item.id);
      items[itemId] = {
        name: item.name,
      };

      if (itemId !== item.id) {
        items[itemId].labId = item.id;
      }

      if (item.stack) {
        items[itemId].stack = item.stack;
      }
    }

    for (const recipe of lab.recipes) {
      procs[recipe.id] = {
        name: recipe.name,
      };
    }

    for (const icon of lab.icons) {
      const itemId = convertId(icon.id);
      if (items[itemId]) {
        items[itemId].iconPos = icon.position;
      }
      if (procs[icon.id]) {
        procs[icon.id].iconPos = icon.position;
      }
    }

    const handleGenItems = (nameSuffix: string, idMatch: RegExp) => {
      for (const id of ourItems) {
        const ma = idMatch.exec(id);
        if (!ma) continue;
        const bareId = ma[1];
        if (!items[bareId]) continue;
        items[id] = {
          name: `${items[bareId].name} ${nameSuffix}`,
          labId: null,
          iconPos: items[bareId].iconPos,
          contained: true,
        };
      }
    };

    const handleGenProc = (name: (orig: string) => string, idMatch: RegExp) => {
      for (const id of ourProcs) {
        const ma = idMatch.exec(id);
        if (!ma) continue;
        const bareId = ma[1];
        if (!items[bareId]) continue;
        procs[id] = {
          name: name(lcFirst(items[bareId].name)),
          iconPos: items[bareId].iconPos,
          contained: true,
        };
      }
    };

    if (handleBarrels) {
      handleGenItems('barrel', /(.+)-barrel/);
      handleGenProc((name) => `Fill ${name} barrel`, /fill-(.+)-barrel/);
      handleGenProc((name) => `Empty ${name} barrel`, /empty-(.+)-barrel/);
    }

    if (handleContainers) {
      handleGenItems('container', /ic-container-(.+)/);
      handleGenProc((name) => `Load ${name}`, /ic-load-(.+)/);
      handleGenProc((name) => `Unload ${name}`, /ic-unload-(.+)/);
    }

    writeFileSync(
      `data/${labId}.json`,
      JSON.stringify(
        {
          items: sortByKeys(items),
          processes: sortByKeys(procs),
        },
        null,
        2,
      ),
    );
    copyFileSync(
      `node_modules/factoriolab/src/data/${labId}/icons.webp`,
      `data/${labId}.webp`,
    );
  }
}

function sortByKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function isExportNamedDeclaration(
  node: { type: string } | null | undefined,
): node is ExportNamedDeclaration {
  return node?.type === 'ExportNamedDeclaration';
}

function isVariableDeclaration(
  node: { type: string } | null | undefined,
): node is VariableDeclaration {
  return node?.type === 'VariableDeclaration';
}

main().catch(console.error);
