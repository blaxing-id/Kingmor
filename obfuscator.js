cat > /home/claude/kingmor/obfuscator.js << 'ENDOFFILE'
"use strict";

/**
 * Kingmor Lua Obfuscator v2
 * Variable renaming + string XOR encoding + number obfuscation + VM wrapper
 * Fixed & improved version
 */

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

function xorEncodeString(str, key) {
  const bytes = Buffer.from(str, "utf8");
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push((bytes[i] ^ key) & 0xff);
  }
  return out;
}

function encodeNumber(n) {
  const a = randomInt(1, 1000);
  const b = n - a;
  if (b >= 0) return `(${a}+${b})`;
  return `(${a}-${Math.abs(b)})`;
}

function addJunkCode() {
  const n1 = randomId(5), n2 = randomId(6), n3 = randomId(4);
  const v1 = randomInt(1000, 9999), v2 = randomInt(10000, 99999), v3 = randomInt(100, 999);
  return `local ${n1},${n2},${n3}=${v1},${v2},${v3};`;
}

// ==================== TOKENIZER ====================

function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    // Whitespace
    if (/[ \t\r\n]/.test(source[i])) {
      let ws = "";
      while (i < source.length && /[ \t\r\n]/.test(source[i])) ws += source[i++];
      tokens.push({ type: "WS", val: ws });
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

    // Long string [==[ ... ]==] or [[ ... ]]
    if (source[i] === "[" && (source[i+1] === "[" || source[i+1] === "=")) {
      let eqCount = 0;
      let j = i + 1;
      while (j < source.length && source[j] === "=") { eqCount++; j++; }
      if (source[j] === "[") {
        const close = "]" + "=".repeat(eqCount) + "]";
        j++;
        let end = source.indexOf(close, j);
        if (end !== -1) {
          tokens.push({ type: "LONGSTRING", val: source.slice(i, end + close.length) });
          i = end + close.length;
          continue;
        }
      }
    }

    // String " ... "
    if (source[i] === '"') {
      let j = i + 1, str = '"';
      while (j < source.length) {
        if (source[j] === "\\" && j + 1 < source.length) { str += source[j] + source[j+1]; j += 2; }
        else if (source[j] === '"') { str += '"'; j++; break; }
        else { str += source[j++]; }
      }
      tokens.push({ type: "STRING", val: str });
      i = j; continue;
    }

    // String ' ... '
    if (source[i] === "'") {
      let j = i + 1, str = "'";
      while (j < source.length) {
        if (source[j] === "\\" && j + 1 < source.length) { str += source[j] + source[j+1]; j += 2; }
        else if (source[j] === "'") { str += "'"; j++; break; }
        else { str += source[j++]; }
      }
      tokens.push({ type: "STRING", val: str });
      i = j; continue;
    }

    // Number (hex)
    if (source.slice(i, i+2) === "0x" || source.slice(i, i+2) === "0X") {
      let num = source[i++] + source[i++];
      while (i < source.length && /[0-9a-fA-F]/.test(source[i])) num += source[i++];
      tokens.push({ type: "NUMBER", val: num }); continue;
    }

    // Number (decimal)
    if (/[0-9]/.test(source[i]) || (source[i] === "." && /[0-9]/.test(source[i+1] || ""))) {
      let num = "";
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
      tokens.push({ type: "NUMBER", val: num }); continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(source[i])) {
      let id = "";
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) id += source[i++];
      const KW = new Set([
        "and","break","do","else","elseif","end","false","for","function",
        "goto","if","in","local","nil","not","or","repeat","return","then",
        "true","until","while"
      ]);
      tokens.push({ type: KW.has(id) ? "KW" : "IDENT", val: id });
      continue;
    }

    // 3-char ops
    if (source.slice(i, i+3) === "...") { tokens.push({ type: "OP", val: "..." }); i += 3; continue; }
    // 2-char ops
    const two = source.slice(i, i+2);
    if (["==","~=","<=",">=","..","::"].includes(two)) { tokens.push({ type: "OP", val: two }); i += 2; continue; }
    // single char
    tokens.push({ type: "PUNCT", val: source[i++] });
  }

  return tokens;
}

// ==================== VARIABLE RENAMER ====================

const ROBLOX_GLOBALS = new Set([
  // Lua builtins
  "print","tostring","tonumber","type","pairs","ipairs","next","select",
  "error","assert","pcall","xpcall","rawget","rawset","rawequal","rawlen",
  "setmetatable","getmetatable","require","load","loadstring","dofile",
  "loadfile","collectgarbage","unpack","table","string","math","os","io",
  "coroutine","utf8","bit32","buffer","_G","_ENV","_VERSION",
  // Roblox globals
  "game","workspace","script","plugin","shared","Enum","Instance",
  "Vector3","Vector2","CFrame","Color3","BrickColor","UDim","UDim2",
  "Ray","Axes","Faces","Region3","TweenInfo","NumberSequence",
  "ColorSequence","NumberRange","Rect","PhysicalProperties","Random",
  "task","wait","delay","spawn","tick","time","elapsedTime","DateTime",
  "typeof","getfenv","setfenv","newproxy","warn",
  "isfile","readfile","writefile","listfiles","delfile","makefolder",
  "getgenv","getrenv","getsenv","getconnections","firetouchinterest",
  "checkcaller","isscriptable","sethiddenproperty","setsimulationradius",
  "hookfunction","hookmetamethod","newcclosure","clonefunction",
  "decompile","getscripts","getloadedmodules","getrunningscripts",
  "setclipboard","toclipboard","getclipboard",
  // Common service refs
  "Players","RunService","UserInputService","TweenService","GuiService",
  "LocalPlayer","Character","Humanoid","HumanoidRootPart","Camera",
  "CoreGui","PlayerGui","PlayerScripts","ControlModule",
  // Types/metamethods
  "true","false","nil",
  "__index","__newindex","__call","__tostring","__len","__eq",
  "__lt","__le","__add","__sub","__mul","__div","__mod","__pow","__unm","__concat",
  // Extra common names
  "self","arg","debug","string","table","math","os","io",
]);

function safeRenameVariables(tokens) {
  const localNames = new Set();

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "KW" && t.val === "local") {
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "WS") j++;

      if (j < tokens.length && tokens[j].type === "KW" && tokens[j].val === "function") {
        j++;
        while (j < tokens.length && tokens[j].type === "WS") j++;
        if (j < tokens.length && tokens[j].type === "IDENT") {
          localNames.add(tokens[j].val);
        }
        continue;
      }

      while (j < tokens.length) {
        const tk = tokens[j];
        if (tk.type === "WS") { j++; continue; }
        if (tk.type === "IDENT") { localNames.add(tk.val); j++; continue; }
        if (tk.type === "PUNCT" && tk.val === ",") { j++; continue; }
        break;
      }
    }

    if (t.type === "KW" && t.val === "function") {
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "WS") j++;
      // skip function name (a.b.c:d style)
      while (j < tokens.length && (tokens[j].type === "IDENT" ||
        (tokens[j].type === "PUNCT" && (tokens[j].val === "." || tokens[j].val === ":")) ||
        (tokens[j].type === "OP" && tokens[j].val === "::"))) j++;
      while (j < tokens.length && tokens[j].type === "WS") j++;
      // parse params
      if (j < tokens.length && tokens[j].type === "PUNCT" && tokens[j].val === "(") {
        j++;
        while (j < tokens.length) {
          const tk = tokens[j];
          if (tk.type === "WS") { j++; continue; }
          if (tk.type === "PUNCT" && tk.val === ")") break;
          if (tk.type === "IDENT") { localNames.add(tk.val); }
          j++;
        }
      }
    }

    if (t.type === "KW" && t.val === "for") {
      let j = i + 1;
      while (j < tokens.length) {
        const tk = tokens[j];
        if (tk.type === "WS") { j++; continue; }
        if (tk.type === "IDENT") { localNames.add(tk.val); j++; continue; }
        if (tk.type === "PUNCT" && tk.val === ",") { j++; continue; }
        break;
      }
    }
  }

  let counter = 0;
  const prefixes = ["l","ll","lI","lll","llI","lIl","lII","I","Il","II","Ill","IlI","IIl","III","llll","lllI","llIl","llII","lIll","lIlI","lIIl","lIII"];

  function genName() {
    const p = prefixes[counter % prefixes.length];
    const n = Math.floor(counter / prefixes.length);
    counter++;
    return n === 0 ? p : p + n;
  }

  const nameMap = new Map();
  for (const name of localNames) {
    if (!ROBLOX_GLOBALS.has(name)) {
      nameMap.set(name, genName());
    }
  }

  let result = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "COMMENT") continue;
    if (t.type === "WS") {
      result += " ";
      continue;
    }
    if (t.type === "IDENT" && nameMap.has(t.val)) {
      result += nameMap.get(t.val);
    } else {
      result += t.val;
    }
  }

  return result.trim();
}

// ==================== STRING OBFUSCATOR ====================

function obfuscateStrings(source) {
  const stringTable = [];
  const stringMap = new Map();

  const result = source.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (match, d, s) => {
    const raw = d !== undefined ? d : s;
    let actual;
    try {
      actual = raw
        .replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
        .replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\'/g, "'")
        .replace(/\\(\d{1,3})/g, (_, n) => String.fromCharCode(parseInt(n)));
    } catch { return match; }

    if (actual.length === 0) return '""';
    if (actual.length > 300) return match;

    if (stringMap.has(actual)) {
      return `__KM_S__[${stringMap.get(actual)}]`;
    }

    const idx = stringTable.length;
    const k = randomInt(1, 255);
    const encoded = xorEncodeString(actual, k);
    stringTable.push({ encoded, key: k });
    stringMap.set(actual, idx);
    return `__KM_S__[${idx}]`;
  });

  return { result, stringTable };
}

// ==================== NUMBER OBFUSCATOR ====================

function obfuscateNumbers(source) {
  return source.replace(/\b(\d+)\b/g, (match, n, offset, str) => {
    const before = str[offset - 1];
    if (before === "[" || before === ".") return match;
    const num = parseInt(n);
    if (isNaN(num) || num > 50000 || num === 0) return match;
    return encodeNumber(num);
  });
}

// ==================== VM WRAPPER ====================

function buildVMWrapper(code, stringTable, discordInvite) {
  const decryptFn = randomId(6);
  const strTblName = randomId(5);
  const execFn = randomId(6);
  const antiDbg = randomId(5);
  const seed = randomInt(100000, 999999);
  const key1 = randomInt(1, 255);

  const etEntries = stringTable.map((e, i) => {
    const reEncoded = e.encoded.map(b => (b ^ key1) & 0xff);
    return `[${i}]={${reEncoded.join(",")}}`;
  });
  const klEntries = stringTable.map((e, i) => `[${i}]=${e.key}`);

  const inviteStr = discordInvite ? ` ${discordInvite}` : "";

  // Build header with fake protection comment
  let out = `-- This script was protected using KingmorArmor v2.0r-gen1${inviteStr}\n`;

  // Anti-debug reference + seed junk
  out += `local ${antiDbg}=debug;`;
  out += `local ${randomId(6)}=${seed};`;
  out += `${addJunkCode()}`;

  // Decrypt function using bit32.bxor
  out += `local function ${decryptFn}(__b,__k,__k2)`;
  out += `local __o=""`;
  out += `for __i=1,#__b do `;
  out += `__o=__o..string.char(bit32.bxor(__b[__i],bit32.bxor(__k,__k2)))`;
  out += `end `;
  out += `return __o `;
  out += `end;`;

  // String table decryption
  out += `local ${strTblName}={};`;
  if (stringTable.length > 0) {
    out += `do `;
    out += `local __et={${etEntries.join(",")}};`;
    out += `local __kl={${klEntries.join(",")}};`;
    out += `for __i=0,${stringTable.length - 1} do `;
    out += `${strTblName}[__i]=${decryptFn}(__et[__i],${key1},__kl[__i])`;
    out += `end `;
    out += `end;`;
  }

  // Junk + alias
  out += `${addJunkCode()}`;
  out += `local __KM_S__=${strTblName};`;

  // Main exec function
  out += `local function ${execFn}()`;
  out += `${addJunkCode()}`;
  out += `${code} `;
  out += `end;`;

  // Protected call
  out += `local __r,__e=pcall(${execFn});`;
  out += `if not __r then end`;

  return out;
}

// ==================== MAIN ====================

async function obfuscate(source, discordInvite) {
  if (!source || typeof source !== "string") {
    throw new Error("Source must be a non-empty string");
  }

  try {
    // Step 1: Tokenize
    const tokens = tokenize(source);

    // Step 2: Rename variables + strip comments + minify whitespace
    const renamed = safeRenameVariables(tokens);

    // Step 3: Obfuscate strings
    const { result: strObf, stringTable } = obfuscateStrings(renamed);

    // Step 4: Obfuscate numbers
    const numObf = obfuscateNumbers(strObf);

    // Step 5: Wrap in VM
    const final = buildVMWrapper(numObf, stringTable, discordInvite);
    return final;

  } catch (err) {
    throw new Error("KingmorArmor failed: " + err.message);
  }
}

module.exports = { obfuscate };
ENDOFFILE
echo "Done writing obfuscator.js"
