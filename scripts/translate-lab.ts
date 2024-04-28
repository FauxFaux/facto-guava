#!/usr/bin/env -S tsx

import { copyFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pascalSnakeCase } from 'change-case';
import { type ModData, ModInfo } from 'factoriolab/src/app/models';
import {
  type ExportNamedDeclaration,
  type VariableDeclaration,
} from '@babel/types';
import { addHook } from 'pirates';
import * as path from 'node:path';
import { transformSync } from '@babel/core';

async function main() {
  const avail = ridiculouslyLoadLab();
  const se = avail.find((a) => a.name === 'Krastorio 2 + SE');
  const data = await load(se!.id);
  const techReqs = Object.fromEntries(
    data.items
      .filter((i) => i.category === 'technology')
      .map((t) => [t.id, t.technology?.prerequisites ?? []] as const),
  );
  console.log(techReqs);
}

async function load(id: string) {
  const data: ModData = await import(`factoriolab/src/data/${id}/data.json`);
  return data;
}

function ridiculouslyLoadLab(): ModInfo[] {
  const require = createRequire(import.meta.url);
  const labDataIndex = require.resolve('factoriolab/src/data');
  const labPath = path.resolve(path.dirname(labDataIndex), '..');

  const revert = addHook(
    (code, filename) =>
      transformSync(code, {
        filename,
        configFile: false,
        presets: ['@babel/preset-typescript'],
        plugins: [
          [
            'module-resolver',
            {
              alias: {
                '^~/(.+)$': `${labPath}/app/\\1`,
              },
            },
          ],
        ],
      })!.code!,
    {
      exts: ['.ts'],
      matcher: (filename) => filename.startsWith(labPath),
    },
  );

  let dataObj: any;
  try {
    dataObj = require('factoriolab/src/data');
  } finally {
    revert();
  }

  return dataObj.data.mods;
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
