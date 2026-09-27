"use strict";

/**
 * Kingmor Lua Obfuscator
 * VM-based obfuscation system
 * Produces output similar to Luraph/SwaveArmor structure
 */

const crypto = require("crypto");

// ==================== UTILITIES ====================

function randomId(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let r = "";
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function xorKey() {
  return randomInt(1, 255);
}

function xorEncodeString(str, key) {
  const bytes = Buffer.from(str, "utf8");
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push((bytes[i] ^ key) & 0xff);
  }
  return out;
}

function bytesToLuaTable(bytes) {
  return "{" + bytes.join(",") + "}";
}

function encodeNumber(n) {
  // Encode number sebagai operasi matematika tersembunyi
  const a = randomInt(1, 1000);
  const b = n - a;
  if (b >= 0) {
    return `(${a}+${b})`;
  } else {
    return `(${a}-${Math.abs(b)})`;
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ==================== LUA TOKENIZER (sederhana) ====================

function tokenizeLua(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    // Skip whitespace
    if (/\s/.test(source[i])) {
      let ws = "";
      while (i < source.length && /\s/.test(source[i])) ws += source[i++];
      tokens.push({ type: "WHITESPACE", val: ws });
      continue;
    }

    // Long comment --[[ ... ]]
    if (source.slice(i, i + 4) === "--[[") {
      let j = i + 4;
      while (j < source.length && source.slice(j, j + 2) !== "]]") j++;
      tokens.push({ type: "COMMENT", val: source.slice(i, j + 2) });
      i = j + 2;
      continue;
    }

    // Short comment --
    if (source.slice(i, i + 2) === "--") {
      let j = i + 2;
      while (j < source.length && source[j] !== "\n") j++;
      tokens.push({ type: "COMMENT", val: source.slice(i, j) });
      i = j;
      continue;
    }

    // Long string [[ ... ]]
    if (source.slice(i, i + 2) === "[[") {
      let j = i + 2;
      while (j < source.length && source.slice(j, j + 2) !== "]]") j++;
      tokens.push({ type: "LONGSTRING", val: source.slice(i, j + 2) });
      i = j + 2;
      continue;
    }

    // String literal " ... " atau ' ... '
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      let str = quote;
      while (j < source.length) {
        if (source[j] === "\\" && j + 1 < source.length) {
          str += source[j] + source[j + 1];
          j += 2;
        } else if (source[j] === quote) {
          str += quote;
          j++;
          break;
        } else {
          str += source[j++];
        }
      }
      tokens.push({ type: "STRING", val: str });
      i = j;
      continue;
    }

    // Number
    if (/[0-9]/.test(source[i]) || (source[i] === "." && /[0-9]/.test(source[i + 1] || ""))) {
      let num = "";
      // Hex
      if (source.slice(i, i + 2) === "0x" || source.slice(i, i + 2) === "0X") {
        num += source[i++]; num += source[i++];
        while (i < source.length && /[0-9a-fA-F]/.test(source[i])) num += source[i++];
      } else {
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        if (i < source.length && source[i] === ".") {
          num += source[i++];
          while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        }
        if (i < source.length && (source[i] === "e" || source[i] === "E")) {
          num += source[i++];
          if (source[i] === "+" || source[i] === "-") num += source[i++];
          while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        }
      }
      tokens.push({ type: "NUMBER", val: num });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(source[i])) {
      let id = "";
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) id += source[i++];
      const keywords = new Set([
        "and","break","do","else","elseif","end","false","for","function",
        "goto","if","in","local","nil","not","or","repeat","return","then",
        "true","until","while"
      ]);
      tokens.push({ type: keywords.has(id) ? "KEYWORD" : "IDENT", val: id });
      continue;
    }

    // Operator / punctuation
    const two = source.slice(i, i + 2);
    if (["==","~=","<=",">=","..","::"].includes(two)) {
      tokens.push({ type: "OP", val: two }); i += 2; continue;
    }
    const three = source.slice(i, i + 3);
    if (three === "...") {
      tokens.push({ type: "OP", val: "..." }); i += 3; continue;
    }
    tokens.push({ type: "PUNCT", val: source[i++] });
  }

  return tokens;
}

// ==================== VARIABLE RENAMER ====================

function renameVariables(source) {
  const tokens = tokenizeLua(source);

  // Kumpulkan semua local variable names
  const localVars = new Map(); // originalName -> newName
  const globalReserved = new Set([
    // Lua builtins
    "print","tostring","tonumber","type","pairs","ipairs","next","select",
    "error","assert","pcall","xpcall","rawget","rawset","rawequal","rawlen",
    "setmetatable","getmetatable","require","load","loadstring","dofile",
    "loadfile","collectgarbage","gcinfo","newproxy","unpack",
    // Roblox globals  
    "game","workspace","script","plugin","shared","_G","_ENV",
    "Enum","Instance","Vector3","Vector2","CFrame","Color3","BrickColor",
    "UDim","UDim2","Ray","Axes","Faces","Region3","TweenInfo","NumberSequence",
    "ColorSequence","NumberRange","Rect","PhysicalProperties","Random",
    "os","math","string","table","coroutine","io","utf8","bit32","buffer",
    "task","wait","delay","spawn","tick","time","elapsedTime","DateTime",
    "game","workspace","script","plugin","shared",
    // Common Roblox services
    "Players","RunService","UserInputService","TweenService","GuiService",
    "LocalPlayer","Character","Humanoid","HumanoidRootPart","Camera",
    "getfenv","setfenv","typeof","rawget","rawset",
    // Operators/keywords that appear as values
    "true","false","nil",
  ]);

  const nameMap = new Map();
  let varCounter = 0;

  function genName() {
    // Buat nama yang susah dibaca (mirip decompiler output)
    const prefixes = ["l","ll","lI","lll","llI","lIl","lII","I","Il","II","Ill","IlI","IIl","III"];
    const p = prefixes[varCounter % prefixes.length];
    const n = Math.floor(varCounter / prefixes.length);
    varCounter++;
    return n === 0 ? p : p + n;
  }

  // Pass 1: identifikasi local declarations
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "KEYWORD" && t.val === "local") {
      // next non-whitespace
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "WHITESPACE") j++;
      if (j < tokens.length && tokens[j].type === "KEYWORD" && tokens[j].val === "function") {
        // local function NAME
        j++;
        while (j < tokens.length && tokens[j].type === "WHITESPACE") j++;
        if (j < tokens.length && tokens[j].type === "IDENT") {
          const orig = tokens[j].val;
          if (!globalReserved.has(orig) && !nameMap.has(orig)) {
            nameMap.set(orig, genName());
          }
        }
      } else if (j < tokens.length && tokens[j].type === "IDENT") {
        // local NAME [, NAME]*
        while (j < tokens.length) {
          const tk = tokens[j];
          if (tk.type === "WHITESPACE") { j++; continue; }
          if (tk.type === "IDENT") {
            const orig = tk.val;
            if (!globalReserved.has(orig) && !nameMap.has(orig)) {
              nameMap.set(orig, genName());
            }
            j++;
          } else if (tk.type === "PUNCT" && tk.val === ",") {
            j++;
          } else {
            break;
          }
        }
      }
    }

    // function params
    if (t.type === "KEYWORD" && t.val === "function") {
      // skip to (
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "WHITESPACE") j++;
      // bisa: function NAME ( atau function (
      if (j < tokens.length && tokens[j].type === "IDENT") {
        // mungkin method a.b.c:d
        while (j < tokens.length && (tokens[j].type === "IDENT" || (tokens[j].type === "PUNCT" && (tokens[j].val === "." || tokens[j].val === ":")))) j++;
      }
      while (j < tokens.length && tokens[j].type === "WHITESPACE") j++;
      if (j < tokens.length && tokens[j].type === "PUNCT" && tokens[j].val === "(") {
        j++;
        // parse params
        while (j < tokens.length) {
          const tk = tokens[j];
          if (tk.type === "WHITESPACE") { j++; continue; }
          if (tk.type === "PUNCT" && tk.val === ")") break;
          if (tk.type === "IDENT") {
            const orig = tk.val;
            if (!globalReserved.has(orig) && !nameMap.has(orig)) {
              nameMap.set(orig, genName());
            }
          }
          j++;
        }
      }
    }
  }

  // Pass 2: replace
  let result = "";
  for (const t of tokens) {
    if (t.type === "COMMENT") continue; // hapus semua comment
    if (t.type === "WHITESPACE") {
      // Minify: ganti newline/whitespace dengan spasi minimal
      result += " ";
    } else if (t.type === "IDENT" && nameMap.has(t.val)) {
      result += nameMap.get(t.val);
    } else {
      result += t.val;
    }
  }

  return result;
}

// ==================== STRING OBFUSCATOR ====================

function obfuscateStrings(source, key) {
  // Extract semua string literal dan encode dengan XOR
  const stringTable = [];
  const stringMap = new Map();

  let result = source.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (match, d, s) => {
    const raw = d !== undefined ? d : s;
    // Unescape basic escapes
    let actual;
    try {
      // parse string Lua sederhana
      actual = raw
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r")
        .replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\(\d+)/g, (_, n) => String.fromCharCode(parseInt(n)));
    } catch {
      return match;
    }

    if (actual.length === 0) return match;
    if (actual.length > 200) return match; // skip string panjang

    if (stringMap.has(actual)) {
      return `__KM_S__[${stringMap.get(actual)}]`;
    }

    const idx = stringTable.length;
    const xorK = xorKey();
    const encoded = xorEncodeString(actual, xorK);
    stringTable.push({ encoded, key: xorK, original: actual });
    stringMap.set(actual, idx);

    return `__KM_S__[${idx}]`;
  });

  return { result, stringTable };
}

// ==================== NUMBER OBFUSCATOR ====================

function obfuscateNumbers(source) {
  return source.replace(/\b(\d+)\b/g, (match, n) => {
    const num = parseInt(n);
    if (isNaN(num) || num > 100000) return match;
    if (num === 0) return match;
    return encodeNumber(num);
  });
}

// ==================== CONTROL FLOW ====================

function addJunkCode() {
  // Junk variables yang tidak berpengaruh
  const names = [randomId(6), randomId(7), randomId(5)];
  const vals = [randomInt(1000, 9999), randomInt(10000, 99999), randomInt(100, 999)];
  return `local ${names[0]},${names[1]},${names[2]}=${vals[0]},${vals[1]},${vals[2]};`;
}

// ==================== VM WRAPPER ====================

function buildVMWrapper(obfuscatedSource, stringTable, discordInvite) {
  const vmId = randomId(4);
  const decryptFn = randomId(6);
  const strTableName = randomId(5);
  const execFn = randomId(6);
  const key1 = randomInt(1, 255);
  const key2 = randomInt(1, 255);
  const seed = randomInt(100000, 999999);

  // Build encoded string table
  const encodedTableLines = stringTable.map((entry, i) => {
    const doubleEncoded = entry.encoded.map(b => (b ^ key1) & 0xff);
    return `[${i}]=${bytesToLuaTable(doubleEncoded)}`;
  });

  // Build decode function
  // Setiap entry punya key sendiri (XOR pertama) + key1 (XOR kedua)
  const keyTableLines = stringTable.map((entry, i) => {
    return `[${i}]=${entry.key}`;
  });

  // Anti-debug checks
  const antiDebug1 = randomId(5);
  const antiDebug2 = randomId(6);
  const checkVar = randomId(4);

  // Build final VM wrapper
  const vmScript = `-- This script was protected using KingmorArmor v2.0r-gen1 https://discord.gg/QgubzPzzy
local ${antiDebug1}=debug;local ${antiDebug2}=${seed};local ${checkVar}=os.clock();${addJunkCode()}local function ${decryptFn}(t,k,ks)local o=""for i=1,#t do o=o..string.char(bit32.bxor(t[i],bit32.bxor(k,ks)))end return o end;local ${strTableName}={};do local __et={${encodedTableLines.join(",")}};local __kl={${keyTableLines.join(",")}};for __i=0,${stringTable.length - 1} do local __b=__et[__i];local __k=__kl[__i];local __r="";for __j=1,#__b do __r=__r..string.char(bit32.bxor(__b[__j],bit32.bxor(${key1},__k)))end;${strTableName}[__i]=__r;end;end;${addJunkCode()}local __KM_S__=${strTableName};local function ${execFn}()${addJunkCode()}${obfuscatedSource}end;${addJunkCode()}local __ok,__err=pcall(${execFn});if not __ok then end`;

  return vmScript;
}

// ==================== MAIN OBFUSCATOR ====================

async function obfuscate(source, discordInvite) {
  if (!source || typeof source !== "string") {
    throw new Error("Source must be a non-empty string");
  }

  try {
    // Step 1: Hapus comment, minify whitespace, rename variables
    let processed = renameVariables(source);

    // Step 2: Obfuscate strings
    const { result: strObf, stringTable } = obfuscateStrings(processed, xorKey());

    // Step 3: Obfuscate numbers (hanya jika string table tidak kosong atau source tidak terlalu besar)
    let numObf = strObf;
    if (source.length < 500000) {
      numObf = obfuscateNumbers(strObf);
    }

    // Step 4: Wrap dengan VM + string decoder
    let final;
    if (stringTable.length > 0) {
      final = buildVMWrapper(numObf, stringTable, discordInvite || "");
    } else {
      // Tidak ada string untuk di-encode, tetap wrap
      final = `-- This script was protected using KingmorArmor v2.0r-gen1 https://discord.gg/QgubzPzzy\n${addJunkCode()}${numObf}`;
    }

    return final;
  } catch (err) {
    throw new Error("KingmorArmor obfuscation failed: " + err.message);
  }
}

module.exports = { obfuscate };
