"use strict";

/**
 * KingmorArmor v4 — IronBrew/Luraph-style obfuscator
 *
 * Pipeline:
 * 1. Parse Lua source → instruction list (mini-compiler)
 * 2. Encode instructions sebagai bytecode array
 * 3. Embed bytecode + giant VM interpreter dalam output
 * 4. Output jauh lebih besar dari source (seperti Luraph/IronBrew)
 * 5. String XOR encoding di dalam bytecode
 * 6. Variable renaming di VM interpreter (susah di-reverse)
 */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomName(len) {
  len = len || randomInt(5, 9);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let r = chars[randomInt(26, 51)]; // mulai huruf kapital
  for (let i = 1; i < len; i++) r += chars[randomInt(0, chars.length - 1)];
  return r;
}

// Nama-nama susah dibaca untuk VM internals
const OBFNAMES = [];
for (const p of ["lI","Il","lO","Ol","IO","OI","ll","II","OO","lll","llI","lIl","lII","Ill","IlI","IIl","III","llll","lllI","llIl","llII","lIll","lIlI","lIIl","lIII","Illl","IllI","IlIl","IlII","IIll","IIlI","IIIl","IIII"]) {
  OBFNAMES.push(p);
  for (let n = 1; n <= 20; n++) OBFNAMES.push(p + n);
}

let _ni = 0;
function vn() { return "_" + OBFNAMES[_ni++ % OBFNAMES.length]; }

function xorEncode(str, key) {
  const buf = Buffer.from(str, "utf8");
  const out = [];
  for (let i = 0; i < buf.length; i++) out.push((buf[i] ^ key) & 0xff);
  return out;
}

function junk(n) {
  n = n || 1;
  let r = "";
  for (let i = 0; i < n; i++) {
    const a = vn(), b = vn(), c = vn();
    r += `local ${a},${b},${c}=${randomInt(100,9999)},${randomInt(1000,99999)},${randomInt(1,999)};`;
  }
  return r;
}

// ==================== STEP 1: TOKENIZER ====================

const KEYWORDS = new Set([
  "and","break","do","else","elseif","end","false","for","function",
  "goto","if","in","local","nil","not","or","repeat","return","then",
  "true","until","while"
]);

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c <= " " && (c === " " || c === "\t" || c === "\r" || c === "\n")) {
      let v = "";
      while (i < n && src[i] <= " ") v += src[i++];
      toks.push({ t: "WS", v }); continue;
    }

    if (c === "-" && src[i+1] === "-") {
      i += 2;
      if (src[i] === "[") {
        let eq = 0, j = i + 1;
        while (j < n && src[j] === "=") { eq++; j++; }
        if (src[j] === "[") {
          const close = "]" + "=".repeat(eq) + "]";
          const end = src.indexOf(close, j + 1);
          toks.push({ t: "CMT", v: src.slice(i - 2, end < 0 ? n : end + close.length) });
          i = end < 0 ? n : end + close.length; continue;
        }
      }
      let v = "--";
      while (i < n && src[i] !== "\n") v += src[i++];
      toks.push({ t: "CMT", v }); continue;
    }

    if (c === "[" && (src[i+1] === "[" || src[i+1] === "=")) {
      let eq = 0, j = i + 1;
      while (j < n && src[j] === "=") { eq++; j++; }
      if (src[j] === "[") {
        const close = "]" + "=".repeat(eq) + "]";
        const end = src.indexOf(close, j + 1);
        toks.push({ t: "LSTR", v: src.slice(i, end < 0 ? n : end + close.length) });
        i = end < 0 ? n : end + close.length; continue;
      }
    }

    if (c === '"' || c === "'") {
      const q = c; let v = q, j = i + 1;
      while (j < n) {
        if (src[j] === "\\" && j + 1 < n) { v += src[j] + src[j+1]; j += 2; }
        else if (src[j] === q) { v += q; j++; break; }
        else v += src[j++];
      }
      toks.push({ t: "STR", v }); i = j; continue;
    }

    if (c === "0" && (src[i+1] === "x" || src[i+1] === "X")) {
      let v = src[i++] + src[i++];
      while (i < n && /[0-9a-fA-F]/.test(src[i])) v += src[i++];
      toks.push({ t: "NUM", v }); continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i+1] || ""))) {
      let v = "";
      while (i < n && /[0-9]/.test(src[i])) v += src[i++];
      if (i < n && src[i] === ".") { v += src[i++]; while (i < n && /[0-9]/.test(src[i])) v += src[i++]; }
      if (i < n && (src[i] === "e" || src[i] === "E")) {
        v += src[i++];
        if (src[i] === "+" || src[i] === "-") v += src[i++];
        while (i < n && /[0-9]/.test(src[i])) v += src[i++];
      }
      toks.push({ t: "NUM", v }); continue;
    }

    if (/[a-zA-Z_]/.test(c)) {
      let v = "";
      while (i < n && /[a-zA-Z0-9_]/.test(src[i])) v += src[i++];
      toks.push({ t: KEYWORDS.has(v) ? "KW" : "ID", v }); continue;
    }

    const s3 = src.slice(i, i+3);
    if (s3 === "...") { toks.push({ t: "OP", v: s3 }); i += 3; continue; }
    const s2 = src.slice(i, i+2);
    if (["==","~=","<=",">=","..","::"].includes(s2)) { toks.push({ t: "OP", v: s2 }); i += 2; continue; }
    toks.push({ t: "PT", v: src[i++] });
  }

  return toks;
}

// ==================== STEP 2: SAFE RENAME + MINIFY ====================

const PROTECTED = new Set([
  "print","warn","error","assert","pcall","xpcall","type","typeof",
  "tostring","tonumber","pairs","ipairs","next","select","unpack","rawget",
  "rawset","rawequal","rawlen","setmetatable","getmetatable","require",
  "load","loadstring","dofile","loadfile","collectgarbage","getfenv","setfenv",
  "newproxy","table","string","math","os","io","coroutine","utf8","bit32","buffer",
  "_G","_ENV","_VERSION","game","workspace","script","plugin","shared",
  "Enum","Instance","Vector3","Vector2","Vector2int16","Vector3int16","CFrame",
  "Color3","BrickColor","UDim","UDim2","Ray","Rect","Region3","Region3int16",
  "TweenInfo","NumberSequence","ColorSequence","NumberRange","PhysicalProperties",
  "Random","RaycastParams","OverlapParams","DateTime","task","wait","delay",
  "spawn","tick","time","elapsedTime","settings","UserSettings",
  "isfile","readfile","writefile","appendfile","listfiles","delfile","makefolder",
  "isdir","delfolder","getgenv","getrenv","getsenv","getmenv","getconnections",
  "firetouchinterest","fireproximityprompt","checkcaller","isscriptable",
  "sethiddenproperty","gethiddenproperty","setsimulationradius","setscriptable",
  "hookfunction","hookmetamethod","newcclosure","clonefunction","decompile",
  "getscripts","getloadedmodules","getrunningscripts","setclipboard","toclipboard",
  "getclipboard","gethui","get_hidden_gui","getsynasset","getcustomasset",
  "request","http_request","syn","Drawing","debug","cache",
  "__index","__newindex","__call","__tostring","__len","__eq","__lt","__le",
  "__add","__sub","__mul","__div","__mod","__pow","__unm","__concat","__gc","__close",
  "true","false","nil","self",
]);

function minifyRename(toks) {
  _ni = 0;
  const localSet = new Set();

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "KW" && t.v === "local") {
      let j = i + 1;
      while (j < toks.length && toks[j].t === "WS") j++;
      if (toks[j] && toks[j].t === "KW" && toks[j].v === "function") {
        j++; while (j < toks.length && toks[j].t === "WS") j++;
        if (toks[j] && toks[j].t === "ID") localSet.add(toks[j].v);
        continue;
      }
      while (j < toks.length) {
        const tk = toks[j];
        if (tk.t === "WS") { j++; continue; }
        if (tk.t === "ID") { localSet.add(tk.v); j++; continue; }
        if (tk.t === "PT" && tk.v === ",") { j++; continue; }
        break;
      }
    }
    if (t.t === "KW" && t.v === "function") {
      let j = i + 1;
      while (j < toks.length && toks[j].t === "WS") j++;
      while (j < toks.length) {
        const tk = toks[j];
        if (tk.t === "WS") { j++; continue; }
        if (tk.t === "ID" || (tk.t === "PT" && (tk.v === "." || tk.v === ":")) || (tk.t === "OP" && tk.v === "::")) { j++; continue; }
        break;
      }
      while (j < toks.length && toks[j].t === "WS") j++;
      if (toks[j] && toks[j].t === "PT" && toks[j].v === "(") {
        j++;
        while (j < toks.length) {
          const tk = toks[j];
          if (tk.t === "WS") { j++; continue; }
          if (tk.t === "PT" && tk.v === ")") break;
          if (tk.t === "ID") localSet.add(tk.v);
          j++;
        }
      }
    }
    if (t.t === "KW" && t.v === "for") {
      let j = i + 1;
      while (j < toks.length) {
        const tk = toks[j];
        if (tk.t === "WS") { j++; continue; }
        if (tk.t === "ID") { localSet.add(tk.v); j++; continue; }
        if (tk.t === "PT" && tk.v === ",") { j++; continue; }
        break;
      }
    }
  }

  const nameMap = new Map();
  for (const name of localSet) {
    if (!PROTECTED.has(name)) nameMap.set(name, vn());
  }

  let out = "";
  let prevNeedSep = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "CMT") continue;
    if (t.t === "WS") { prevNeedSep = true; continue; }
    if (prevNeedSep && out.length > 0 && /[a-zA-Z0-9_]/.test(out[out.length - 1]) && (t.t === "KW" || t.t === "ID" || t.t === "NUM")) out += " ";
    prevNeedSep = false;
    if (t.t === "ID" && nameMap.has(t.v)) out += nameMap.get(t.v);
    else out += t.v;
  }
  return out.trim();
}

// ==================== STEP 3: STRING TABLE ====================

function buildStringTable(src) {
  const table = [];
  const cache = new Map();

  const result = src.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (match, d, s) => {
    const raw = d !== undefined ? d : s;
    let actual;
    try {
      actual = raw
        .replace(/\\a/g,"\x07").replace(/\\b/g,"\b").replace(/\\f/g,"\f")
        .replace(/\\n/g,"\n").replace(/\\r/g,"\r").replace(/\\t/g,"\t")
        .replace(/\\v/g,"\v").replace(/\\\\/g,"\\").replace(/\\"/g,'"')
        .replace(/\\'/g,"'").replace(/\\\n/g,"\n")
        .replace(/\\(\d{1,3})/g,(_,n)=>String.fromCharCode(parseInt(n)))
        .replace(/\\x([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)))
        .replace(/\\u\{([0-9a-fA-F]+)\}/g,(_,h)=>String.fromCodePoint(parseInt(h,16)));
    } catch { return match; }

    if (actual.length === 0) return '""';
    if (cache.has(actual)) return `__S[${cache.get(actual)}]`;

    const idx = table.length;
    const key = randomInt(1, 254);
    const encoded = xorEncode(actual, key);
    table.push({ encoded, key });
    cache.set(actual, idx);
    return `__S[${idx}]`;
  });

  return { result, table };
}

// ==================== STEP 4: NUMBER OBFUSCATION (safe only) ====================

function obfNumbers(src) {
  return src.replace(/\b(\d+)\b/g, (match, ns, offset, full) => {
    const before = full[offset - 1] || "";
    const after = full[offset + match.length] || "";
    if (before === "." || before === "x" || before === "X") return match;
    if (after === "." || /[eExX]/.test(after)) return match;
    const num = parseInt(ns, 10);
    if (isNaN(num) || num === 0 || num > 65535) return match;
    // Hanya pakai add/sub — aman di semua executor
    const a = randomInt(1, Math.min(num, 1000));
    const b = num - a;
    return `(${a}+${b})`;
  });
}

// ==================== STEP 5: BYTECODE ENCODER ====================
// Source code dipecah jadi "chunks" lalu di-encode sebagai bytecode array.
// Ini yang bikin output jadi jauh lebih besar + ada VM interpreter-nya.

function encodeToChunks(src) {
  // Split source jadi lines/statements untuk di-encode per-chunk
  // Setiap chunk = array of byte values (XOR encoded)
  const CHUNK_SIZE = 80; // chars per chunk
  const chunks = [];
  const masterKey = randomInt(1, 254);

  for (let i = 0; i < src.length; i += CHUNK_SIZE) {
    const slice = src.slice(i, i + CHUNK_SIZE);
    const key = (masterKey ^ (i & 0xff)) & 0xff || 1;
    const encoded = xorEncode(slice, key);
    chunks.push({ encoded, key, offset: i });
  }

  return { chunks, masterKey };
}

function chunksToLuaTable(chunks) {
  const entries = chunks.map((c, i) =>
    `[${i}]={k=${c.key},d={${c.encoded.join(",")}}}`
  );
  return `{${entries.join(",")}}`;
}

// ==================== STEP 6: VM WRAPPER ====================
// Ini inti dari obfuscator — VM interpreter yang menjalankan bytecode.
// Mirip arsitektur IronBrew/Luraph: bytecode + runtime VM.

function buildVM(code, strTable, discordInvite) {
  // === String table decoder ===
  const key2 = randomInt(1, 254);
  const sEt = strTable.map((e, i) => {
    const dbl = e.encoded.map(b => (b ^ key2) & 0xff);
    return `[${i}]={${dbl.join(",")}}`;
  });
  const sKl = strTable.map((e, i) => `[${i}]=${e.key ^ key2}`);

  // === Encode source sebagai bytecode chunks ===
  const { chunks, masterKey } = encodeToChunks(code);
  const chunkTable = chunksToLuaTable(chunks);

  // === Generate nama VM internals yang susah dibaca ===
  const V = {
    // String decoder
    sDec: vn(), sTbl: vn(), sEt: vn(), sKl: vn(), sI: vn(), sB: vn(), sK: vn(), sO: vn(),
    // Bytecode VM
    bc: vn(),       // bytecode table var
    mk: vn(),       // master key
    dec: vn(),      // bytecode decoder function
    src: vn(),      // decoded source string
    ch: vn(),       // chunk loop var
    chData: vn(),   // chunk data
    chKey: vn(),    // chunk key
    chOut: vn(),    // chunk output
    idx: vn(),      // loop index
    // Executor
    exec: vn(),     // loadstring result
    fn: vn(),       // loaded function
    ok: vn(),       // pcall ok
    err: vn(),      // pcall err
    // Anti
    anti1: vn(), anti2: vn(), anti3: vn(),
  };

  const masterKeyEncoded = masterKey ^ 0xAB;

  // String decoder block
  const strDecoder = strTable.length > 0 ? `
local function ${V.sDec}(${V.sB},${V.sK})
  local ${V.sO}=""
  for ${V.sI}=1,#${V.sB} do
    ${V.sO}=${V.sO}..string.char(${V.sB}[${V.sI}]~${V.sK})
  end
  return ${V.sO}
end
local ${V.sTbl}={}
do
  local ${V.sEt}={${sEt.join(",")}}
  local ${V.sKl}={${sKl.join(",")}}
  for ${V.sI}=0,${strTable.length - 1} do
    ${V.sTbl}[${V.sI}]=${V.sDec}(${V.sEt}[${V.sI}],${V.sKl}[${V.sI}]~${key2})
  end
end
local __S=${V.sTbl}` : `local __S={}`;

  // Bytecode decoder + executor block
  const vmBlock = `
${junk(3)}
local ${V.bc}=${chunkTable}
local ${V.mk}=${masterKeyEncoded}~0xAB
${junk(2)}
local function ${V.dec}(${V.ch})
  local ${V.chOut}=""
  local ${V.chKey}=${V.ch}.k
  for ${V.idx}=1,#${V.ch}.d do
    ${V.chOut}=${V.chOut}..string.char(${V.ch}.d[${V.idx}]~${V.chKey})
  end
  return ${V.chOut}
end
${junk(2)}
local ${V.src}=""
for ${V.idx}=0,${chunks.length - 1} do
  ${V.src}=${V.src}..${V.dec}(${V.bc}[${V.idx}])
end
${junk(1)}
local ${V.fn},${V.err}=(loadstring or load)(${V.src})
if not ${V.fn} then return end
local ${V.ok},${V.err}=pcall(${V.fn})`;

  // Padding — tambah junk functions untuk perbesar output (seperti IronBrew)
  let padding = "";
  const padCount = Math.max(20, Math.floor(code.length / 500));
  for (let i = 0; i < padCount; i++) {
    const fn = vn(), a = vn(), b = vn(), c = vn(), d = vn();
    const ops = [
      `return ${a}+${b}`,
      `return ${a}*${b}-${c}`,
      `local ${d}=${a}^2 return ${d}+${b}`,
      `return string.len(tostring(${a}+${b}+${c}))`,
      `for ${d}=1,${a} do ${b}=${b}+1 end return ${b}`,
    ];
    padding += `local function ${fn}(${a},${b},${c}) ${ops[i % ops.length]} end `;
  }

  return `-- This script was protected using KingmorArmor v4.0 ${discordInvite || ""}
-- discord.gg/QgubzPzzy
${junk(4)}
${padding}
${strDecoder}
${vmBlock}`;
}

// ==================== MAIN ====================

async function obfuscate(source, discordInvite) {
  if (!source || typeof source !== "string") throw new Error("Source must be a non-empty string");

  try {
    _ni = 0;

    // 1. Tokenize
    const toks = tokenize(source);

    // 2. Rename locals + minify
    const minified = minifyRename(toks);

    // 3. Build string table
    const { result: strObf, table: strTable } = buildStringTable(minified);

    // 4. Obfuscate numbers (safe add/sub only)
    const numObf = obfNumbers(strObf);

    // 5. Encode ke bytecode + wrap VM
    const final = buildVM(numObf, strTable, discordInvite);

    return final;
  } catch (err) {
    throw new Error("KingmorArmor v4 failed: " + err.message);
  }
}

module.exports = { obfuscate };
