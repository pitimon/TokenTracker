#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stringValues(xml) {
  return [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => decodeXml(match[1]));
}

function inspectPlistXml(xml, packageName) {
  const packagePattern = new RegExp(
    `${escapeRegExp(packageName)}(?:@([0-9A-Za-z][0-9A-Za-z._-]*))?(?![0-9A-Za-z_./-])`,
    "g"
  );
  const values = stringValues(xml);
  const versions = [];
  let pinCount = 0;
  for (const value of values) {
    for (const match of value.matchAll(packagePattern)) {
      pinCount += 1;
      if (match[1] && /^[0-9]/.test(match[1])) versions.push(match[1]);
    }
  }
  const joined = values.join(" ");
  const portMatch = joined.match(/--port(?:\s+|=)([0-9]+)/);
  return {
    versions: [...new Set(versions)].sort(),
    pinCount,
    port: portMatch ? Number(portMatch[1]) : 7680,
  };
}

function repinPlistXml(xml, packageName, version) {
  const packagePattern = new RegExp(
    `${escapeRegExp(packageName)}(?:@[0-9A-Za-z][0-9A-Za-z._-]*)?(?![0-9A-Za-z_./-])`,
    "g"
  );
  return xml.replace(/<string>([\s\S]*?)<\/string>/g, (whole, content) => {
    if (!content.includes(packageName)) return whole;
    return `<string>${content.replace(packagePattern, `${packageName}@${version}`)}</string>`;
  });
}

function writeAtomic(file, content) {
  const stat = fs.statSync(file);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, content, { mode: stat.mode });
  fs.chmodSync(temp, stat.mode);
  fs.renameSync(temp, file);
}

function cli(argv) {
  const [command, file, packageName, version] = argv;
  if (!command || !file || !packageName || (command === "repin" && !version)) {
    throw new Error("usage: launchagent-plist.cjs inspect <plist> <package> | repin <plist> <package> <version>");
  }
  const xml = fs.readFileSync(file, "utf8");
  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(inspectPlistXml(xml, packageName))}\n`);
    return;
  }
  if (command !== "repin") throw new Error(`unsupported command: ${command}`);
  const updated = repinPlistXml(xml, packageName, version);
  const receipt = inspectPlistXml(updated, packageName);
  if (receipt.pinCount < 1 || receipt.versions.length !== 1 || receipt.versions[0] !== version) {
    throw new Error(`failed to repin ${path.basename(file)} to ${version}`);
  }
  writeAtomic(file, updated);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

module.exports = { inspectPlistXml, repinPlistXml };

if (require.main === module) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
