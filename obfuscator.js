/**
 * KingmorArmor v2.1r-gen3
 * Scope-safe Lua/Luau compiler + SwaveArmor-style buffer VM.
 * Output is native Luau: table/call/arithmetic go through the host, so Roblox APIs work.
 */
// @ts-nocheck
"use strict";

const VERSION = "v2.1r-gen3";
const PRODUCT = "KingmorArmor";

const LUA_KW = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while", "continue",
]);

const OP3 = ["//=", "..=", "..."];
const OP2 = [
  "==", "~=", "<=", ">=", "..", "::", "<<", ">>", "//",
  "+=", "-=", "*=", "/=", "%=", "^=", "->",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function unescapeLua(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") {
      out += raw[i];
      continue;
    }
    const n = raw[i + 1];
    if (n === undefined) break;
    i++;
    const map = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'", "\n": "" };
    if (n in map) {
      out += map[n];
    } else if (n === "x" && /[0-9a-fA-F]/.test(raw[i + 1])) {
      let h = "";
      while (h.length < 2 && /[0-9a-fA-F]/.test(raw[i + 1])) h += raw[++i];
      out += String.fromCharCode(parseInt(h, 16));
    } else if (n === "u" && raw[i + 1] === "{") {
      i++;
      let h = "";
      while (raw[i + 1] && raw[i + 1] !== "}") h += raw[++i];
      if (raw[i + 1] === "}") i++;
      out += String.fromCharCode(parseInt(h, 16) || 0);
    } else if (/[0-9]/.test(n)) {
      let d = n;
      while (d.length < 3 && /[0-9]/.test(raw[i + 1])) d += raw[++i];
      out += String.fromCharCode(parseInt(d, 10) % 256);
    } else {
      out += n;
    }
  }
  return out;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const N = src.length;
  const push = (type, value, pos) => tokens.push({ type, value, pos });

  while (i < N) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        let j = i + 3, eq = 0;
        while (src[j] === "=") {
          eq++;
          j++;
        }
        if (src[j] === "[") {
          const close = "]" + "=".repeat(eq) + "]";
          const end = src.indexOf(close, j + 1);
          i = end === -1 ? N : end + close.length;
          continue;
        }
      }
      while (i < N && src[i] !== "\n") i++;
      continue;
    }
    if (c === "[" && (src[i + 1] === "[" || src[i + 1] === "=")) {
      let j = i + 1, eq = 0;
      while (src[j] === "=") {
        eq++;
        j++;
      }
      if (src[j] === "[") {
        const close = "]" + "=".repeat(eq) + "]";
        let k = j + 1;
        if (src[k] === "\n") k++;
        const end = src.indexOf(close, k);
        if (end === -1) throw new Error("Unfinished long string");
        push("STRING", src.slice(k, end), i);
        i = end + close.length;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1, raw = "";
      while (j < N) {
        if (src[j] === "\\" && j + 1 < N) {
          raw += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        if (src[j] === "\n") throw new Error("Unfinished string");
        raw += src[j++];
      }
      push("STRING", unescapeLua(raw), i);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1, raw = "";
      while (j < N && src[j] !== "`") {
        if (src[j] === "\\" && j + 1 < N) {
          raw += src[j] + src[j + 1];
          j += 2;
        } else raw += src[j++];
      }
      push("STRING", unescapeLua(raw), i);
      i = j + 1;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OP3.includes(three)) {
      push("OP", three, i);
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OP2.includes(two)) {
      push("OP", two, i);
      i += 2;
      continue;
    }
    if (two === "0x" || two === "0X" || two === "0b" || two === "0B") {
      const hex = two[1] === "x" || two[1] === "X";
      let j = i + 2, num = two;
      const re = hex ? /[0-9a-fA-F_]/ : /[01_]/;
      while (j < N && re.test(src[j])) num += src[j++];
      push("NUMBER", num.replace(/_/g, ""), i);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i, num = "";
      while (j < N && /[0-9_]/.test(src[j])) num += src[j++];
      if (src[j] === ".") {
        num += src[j++];
        while (j < N && /[0-9_]/.test(src[j])) num += src[j++];
      }
      if (src[j] === "e" || src[j] === "E") {
        num += src[j++];
        if (src[j] === "+" || src[j] === "-") num += src[j++];
        while (j < N && /[0-9_]/.test(src[j])) num += src[j++];
      }
      push("NUMBER", num.replace(/_/g, ""), i);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i, id = "";
      while (j < N && /[A-Za-z0-9_]/.test(src[j])) id += src[j++];
      push(LUA_KW.has(id) ? "KW" : "IDENT", id, i);
      i = j;
      continue;
    }
    if (c === "#") {
      push("OP", "#", i);
      i++;
      continue;
    }
    push("PUNCT", c, i);
    i++;
  }
  push("EOF", "", i);
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }
  peek() {
    return this.t[this.i] || this.t[this.t.length - 1];
  }
  at(type, value) {
    const p = this.peek();
    return p.type === type && (value === undefined || p.value === value);
  }
  eat(type, value) {
    if (this.at(type, value)) {
      return this.t[this.i++];
    }
    return null;
  }
  expect(type, value) {
    const p = this.peek();
    if (p.type !== type || (value !== undefined && p.value !== value)) {
      throw new Error(`Expected ${value || type} at ${p.pos}, got ${p.type} '${p.value}'`);
    }
    return this.t[this.i++];
  }
  skipAttr() {
    if (this.at("OP", "<") || this.at("PUNCT", "<")) {
      this.i++;
      while (!this.at("OP", ">") && !this.at("PUNCT", ">") && !this.at("EOF")) this.i++;
      if (this.at("OP", ">") || this.at("PUNCT", ">")) this.i++;
    }
  }
  skipType() {
    if (!this.at("PUNCT", ":") && !this.at("OP", "::")) return;
    if (this.at("OP", "::")) this.i++;
    else this.i++;
    this.skipTypeNode();
  }
  skipTypeNode() {
    this.skipTypePrimary();
    while (this.at("PUNCT", "?") || this.at("OP", "?")) this.i++;
    while (this.at("PUNCT", "|") || this.at("PUNCT", "&")) {
      this.i++;
      this.skipTypePrimary();
      while (this.at("PUNCT", "?")) this.i++;
    }
  }
  skipTypePrimary() {
    if (this.at("PUNCT", "(")) {
      this.skipBalanced("(", ")");
      if (this.at("OP", "->")) {
        this.i++;
        this.skipTypeNode();
      }
      return;
    }
    if (this.at("PUNCT", "{")) {
      this.skipBalanced("{", "}");
      return;
    }
    if (this.at("IDENT") || this.at("KW")) {
      const n = this.t[this.i++];
      if (n.value === "typeof" && this.at("PUNCT", "(")) this.skipBalanced("(", ")");
      while (this.at("PUNCT", ".")) {
        this.i++;
        if (this.at("IDENT") || this.at("KW")) this.i++;
      }
      if (this.at("OP", "<") || this.at("PUNCT", "<")) {
        this.i++;
        let d = 1;
        while (d && !this.at("EOF")) {
          const p = this.peek();
          if (p.value === "<") d++;
          else if (p.value === ">") d--;
          this.i++;
        }
      }
      return;
    }
    if (this.at("STRING") || this.at("NUMBER")) this.i++;
  }
  skipBalanced(open, close) {
    this.i++;
    let d = 1;
    while (d && !this.at("EOF")) {
      const p = this.peek();
      if (p.value === open) d++;
      else if (p.value === close) d--;
      this.i++;
    }
  }
  skipTypeStmt() {
    if (this.peek().value === "export") this.i++;
    if (this.peek().value === "type") this.i++;
    if (this.at("IDENT")) this.i++;
    if (this.at("OP", "<") || this.at("PUNCT", "<")) {
      this.i++;
      let d = 1;
      while (d && !this.at("EOF")) {
        if (this.peek().value === "<") d++;
        else if (this.peek().value === ">") d--;
        this.i++;
      }
    }
    this.eat("PUNCT", "=");
    this.skipTypeNode();
  }

  parseChunk() {
    const body = this.parseBlock(true);
    if (!this.at("EOF")) {
      const p = this.peek();
      throw new Error(`Unexpected '${p.value}' at ${p.pos}`);
    }
    return { type: "chunk", body };
  }

  parseBlock(top) {
    const body = [];
    while (!this.at("EOF")) {
      if (this.at("KW", "end") || this.at("KW", "else") || this.at("KW", "elseif") || this.at("KW", "until")) break;
      if (this.at("KW", "return")) {
        body.push(this.parseReturn());
        this.eat("PUNCT", ";");
        break;
      }
      const s = this.parseStat();
      if (s) body.push(s);
      this.eat("PUNCT", ";");
    }
    return body;
  }

  parseStat() {
    if (this.eat("PUNCT", ";")) return { type: "empty" };
    if (this.at("KW", "if")) return this.parseIf();
    if (this.eat("KW", "do")) {
      const body = this.parseBlock();
      this.expect("KW", "end");
      return { type: "do", body };
    }
    if (this.eat("KW", "while")) {
      const cond = this.parseExp();
      this.expect("KW", "do");
      const body = this.parseBlock();
      this.expect("KW", "end");
      return { type: "while", cond, body };
    }
    if (this.eat("KW", "repeat")) {
      const body = this.parseBlock();
      this.expect("KW", "until");
      return { type: "repeat", body, cond: this.parseExp() };
    }
    if (this.at("KW", "for")) return this.parseFor();
    if (this.at("KW", "function")) return this.parseFuncStat();
    if (this.at("KW", "local")) return this.parseLocal();
    if (this.eat("KW", "break")) return { type: "break" };
    if (this.eat("KW", "continue")) return { type: "continue" };
    if (this.eat("KW", "goto")) return { type: "goto", name: this.expect("IDENT").value };
    if (this.at("OP", "::")) {
      this.i++;
      const name = this.expect("IDENT").value;
      this.expect("OP", "::");
      return { type: "label", name };
    }
    if (
      (this.at("IDENT", "export") && this.t[this.i + 1] && this.t[this.i + 1].value === "type") ||
      (this.at("IDENT", "type") && this.t[this.i + 1] && this.t[this.i + 1].type === "IDENT")
    ) {
      this.skipTypeStmt();
      return { type: "empty" };
    }
    return this.parseAssignOrCall();
  }

  parseReturn() {
    this.expect("KW", "return");
    if (this.at("KW", "end") || this.at("KW", "else") || this.at("KW", "elseif") ||
        this.at("KW", "until") || this.at("EOF") || this.at("PUNCT", ";")) {
      return { type: "return", values: [] };
    }
    return { type: "return", values: this.parseExpList() };
  }

  parseIf() {
    this.expect("KW", "if");
    const clauses = [];
    const cond = this.parseExp();
    this.expect("KW", "then");
    clauses.push({ cond, body: this.parseBlock() });
    while (this.eat("KW", "elseif")) {
      const c = this.parseExp();
      this.expect("KW", "then");
      clauses.push({ cond: c, body: this.parseBlock() });
    }
    let elseBody = null;
    if (this.eat("KW", "else")) elseBody = this.parseBlock();
    this.expect("KW", "end");
    return { type: "if", clauses, elseBody };
  }

  parseFor() {
    this.expect("KW", "for");
    const n1 = this.expect("IDENT").value;
    this.skipAttr();
    this.skipType();
    if (this.eat("PUNCT", "=")) {
      const from = this.parseExp();
      this.expect("PUNCT", ",");
      const to = this.parseExp();
      let step = null;
      if (this.eat("PUNCT", ",")) step = this.parseExp();
      this.expect("KW", "do");
      const body = this.parseBlock();
      this.expect("KW", "end");
      return { type: "fornum", name: n1, from, to, step, body };
    }
    const names = [n1];
    while (this.eat("PUNCT", ",")) {
      names.push(this.expect("IDENT").value);
      this.skipAttr();
      this.skipType();
    }
    this.expect("KW", "in");
    const iters = this.parseExpList();
    this.expect("KW", "do");
    const body = this.parseBlock();
    this.expect("KW", "end");
    return { type: "forin", names, iters, body };
  }

  parseFuncStat() {
    this.expect("KW", "function");
    const path = [this.expect("IDENT").value];
    let method = null;
    while (this.eat("PUNCT", ".")) path.push(this.expect("IDENT").value);
    if (this.eat("PUNCT", ":")) method = this.expect("IDENT").value;
    const fn = this.parseFuncBody(method != null);
    return { type: "funcstat", path, method, fn };
  }

  parseLocal() {
    this.expect("KW", "local");
    if (this.eat("KW", "function")) {
      const name = this.expect("IDENT").value;
      const fn = this.parseFuncBody(false);
      return { type: "localfunc", name, fn };
    }
    if (this.at("KW", "type")) {
      this.i++;
      this.skipTypeStmt();
      return { type: "empty" };
    }
    const names = [];
    do {
      names.push(this.expect("IDENT").value);
      this.skipAttr();
      this.skipType();
    } while (this.eat("PUNCT", ","));
    let values = [];
    if (this.eat("PUNCT", "=")) values = this.parseExpList();
    return { type: "local", names, values };
  }

  parseFuncBody(needSelf) {
    this.expect("PUNCT", "(");
    const params = [];
    let vararg = false;
    if (needSelf) params.push("self");
    if (!this.at("PUNCT", ")")) {
      do {
        if (this.eat("OP", "...")) {
          vararg = true;
          break;
        }
        params.push(this.expect("IDENT").value);
        this.skipAttr();
        this.skipType();
      } while (this.eat("PUNCT", ","));
    }
    this.expect("PUNCT", ")");
    this.skipType();
    const body = this.parseBlock();
    this.expect("KW", "end");
    return { type: "function", params, vararg, body };
  }

  parseAssignOrCall() {
    const prefix = this.parsePrefix();
    const compound = this.peek();
    if (compound.type === "OP" && ["+=", "-=", "*=", "/=", "%=", "^=", "..=", "//="].includes(compound.value)) {
      this.i++;
      const op = compound.value.slice(0, -1);
      const value = this.parseExp();
      return { type: "compound", target: prefix, op, value };
    }
    if (this.at("PUNCT", ",") || this.at("PUNCT", "=")) {
      const vars = [prefix];
      while (this.eat("PUNCT", ",")) vars.push(this.parsePrefix());
      this.expect("PUNCT", "=");
      return { type: "assign", vars, values: this.parseExpList() };
    }
    if (prefix.type !== "call") {
      throw new Error(`Unexpected statement starting at ${this.peek().pos}`);
    }
    return { type: "callstat", exp: prefix };
  }

  parseExpList() {
    const list = [this.parseExp()];
    while (this.eat("PUNCT", ",")) list.push(this.parseExp());
    return list;
  }

  parseExp() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.eat("KW", "or")) left = { type: "binop", op: "or", left, right: this.parseAnd() };
    return left;
  }
  parseAnd() {
    let left = this.parseCmp();
    while (this.eat("KW", "and")) left = { type: "binop", op: "and", left, right: this.parseCmp() };
    return left;
  }
  parseCmp() {
    let left = this.parseConcat();
    while (true) {
      const p = this.peek();
      if (p.type === "OP" && ["==", "~=", "<=", ">=", "<", ">"].includes(p.value)) {
        this.i++;
        left = { type: "binop", op: p.value, left, right: this.parseConcat() };
      } else if (p.type === "PUNCT" && (p.value === "<" || p.value === ">")) {
        this.i++;
        left = { type: "binop", op: p.value, left, right: this.parseConcat() };
      } else break;
    }
    return left;
  }
  parseConcat() {
    let left = this.parseAdd();
    if (this.eat("OP", "..")) {
      return { type: "binop", op: "..", left, right: this.parseConcat() };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (true) {
      if (this.eat("PUNCT", "+")) left = { type: "binop", op: "+", left, right: this.parseMul() };
      else if (this.eat("PUNCT", "-") || this.eat("OP", "-")) left = { type: "binop", op: "-", left, right: this.parseMul() };
      else break;
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (true) {
      if (this.eat("PUNCT", "*")) left = { type: "binop", op: "*", left, right: this.parseUnary() };
      else if (this.eat("PUNCT", "/")) left = { type: "binop", op: "/", left, right: this.parseUnary() };
      else if (this.eat("PUNCT", "%")) left = { type: "binop", op: "%", left, right: this.parseUnary() };
      else if (this.eat("OP", "//")) left = { type: "binop", op: "//", left, right: this.parseUnary() };
      else break;
    }
    return left;
  }
  parseUnary() {
    if (this.eat("KW", "not")) return { type: "unop", op: "not", arg: this.parseUnary() };
    if (this.eat("PUNCT", "-") || this.eat("OP", "-")) return { type: "unop", op: "-", arg: this.parseUnary() };
    if (this.eat("OP", "#") || this.eat("PUNCT", "#")) return { type: "unop", op: "#", arg: this.parseUnary() };
    if (this.eat("OP", "~") || this.eat("PUNCT", "~")) return { type: "unop", op: "~", arg: this.parseUnary() };
    return this.parsePow();
  }
  parsePow() {
    const left = this.parsePrefix();
    if (this.eat("PUNCT", "^")) return { type: "binop", op: "^", left, right: this.parseUnary() };
    return left;
  }

  parsePrefix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.eat("PUNCT", ".")) {
        const name = this.expect("IDENT").value;
        node = { type: "field", obj: node, name };
        continue;
      }
      if (this.eat("PUNCT", "[")) {
        const key = this.parseExp();
        this.expect("PUNCT", "]");
        node = { type: "index", obj: node, key };
        continue;
      }
      if (this.eat("PUNCT", ":")) {
        const name = this.expect("IDENT").value;
        const args = this.parseArgs();
        node = { type: "call", func: node, args, method: name };
        continue;
      }
      if (this.at("PUNCT", "(") || this.at("PUNCT", "{") || this.at("STRING")) {
        node = { type: "call", func: node, args: this.parseArgs(), method: null };
        continue;
      }
      this.skipType();
      break;
    }
    return node;
  }

  parseArgs() {
    if (this.eat("PUNCT", "(")) {
      const args = this.at("PUNCT", ")") ? [] : this.parseExpList();
      this.expect("PUNCT", ")");
      return args;
    }
    if (this.at("PUNCT", "{")) return [this.parseTable()];
    if (this.at("STRING")) return [{ type: "string", value: this.t[this.i++].value }];
    throw new Error("Expected arguments");
  }

  parsePrimary() {
    if (this.eat("KW", "nil")) return { type: "nil" };
    if (this.eat("KW", "true")) return { type: "bool", value: true };
    if (this.eat("KW", "false")) return { type: "bool", value: false };
    if (this.at("NUMBER")) {
      const v = this.t[this.i++].value;
      let num;
      if (/^0[xX]/.test(v)) num = parseInt(v, 16);
      else if (/^0[bB]/.test(v)) num = parseInt(v.slice(2), 2);
      else num = Number(v);
      return { type: "number", value: num };
    }
    if (this.at("STRING")) return { type: "string", value: this.t[this.i++].value };
    if (this.eat("OP", "...")) return { type: "varargs" };
    if (this.eat("KW", "function")) return this.parseFuncBody(false);
    if (this.at("PUNCT", "{")) return this.parseTable();
    if (this.eat("PUNCT", "(")) {
      const e = this.parseExp();
      this.expect("PUNCT", ")");
      return e;
    }
    if (this.at("KW", "if")) return this.parseIfExp();
    if (this.at("IDENT")) return { type: "name", name: this.t[this.i++].value };
    const p = this.peek();
    throw new Error(`Unexpected '${p.value}' in expression at ${p.pos}`);
  }

  parseIfExp() {
    this.expect("KW", "if");
    const cond = this.parseExp();
    this.expect("KW", "then");
    const thenE = this.parseExp();
    const elseifs = [];
    while (this.eat("KW", "elseif")) {
      const c = this.parseExp();
      this.expect("KW", "then");
      elseifs.push({ cond: c, then: this.parseExp() });
    }
    this.expect("KW", "else");
    const elseE = this.parseExp();
    let node = { type: "ifexp", cond, then: thenE, else: elseE };
    for (let i = elseifs.length - 1; i >= 0; i--) {
      node = { type: "ifexp", cond: elseifs[i].cond, then: elseifs[i].then, else: node };
    }
    return node;
  }

  parseTable() {
    this.expect("PUNCT", "{");
    const fields = [];
    while (!this.at("PUNCT", "}") && !this.at("EOF")) {
      if (this.eat("PUNCT", "[")) {
        const key = this.parseExp();
        this.expect("PUNCT", "]");
        this.expect("PUNCT", "=");
        fields.push({ rec: true, key, value: this.parseExp() });
      } else if (this.at("IDENT") && this.t[this.i + 1] && this.t[this.i + 1].type === "PUNCT" && this.t[this.i + 1].value === "=") {
        const name = this.t[this.i++].value;
        this.expect("PUNCT", "=");
        fields.push({ rec: true, key: { type: "string", value: name }, value: this.parseExp() });
      } else {
        fields.push({ rec: false, value: this.parseExp() });
      }
      if (this.eat("PUNCT", ",") || this.eat("PUNCT", ";")) continue;
      break;
    }
    this.expect("PUNCT", "}");
    return { type: "table", fields };
  }
}

const BASE_OPS = [
  "PUSHNIL", "PUSHTRUE", "PUSHFALSE", "PUSHK", "PUSHI",
  "GETLOCAL", "SETLOCAL", "GETUPVAL", "SETUPVAL",
  "GETGLOBAL", "SETGLOBAL", "GETTABLE", "SETTABLE",
  "GETFIELD", "SETFIELD", "SELF", "NEWTABLE",
  "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "IDIV", "CONCAT",
  "BAND", "BOR", "BXOR", "SHL", "SHR",
  "UNM", "NOT", "LEN", "BNOT",
  "EQ", "NE", "LT", "LE", "GT", "GE",
  "JMP", "TESTF", "TESTT", "TESTNIL", "ANDSKIP", "ORSKIP",
  "CALL", "RETURN", "FORPREP", "FORLOOP", "TFOR",
  "CLOSURE", "VARARG", "POP", "DUP", "CLOSE",
  "SWAP", "LOADBOOL",
];

function insn(op, a = 0, b = 0, c = 0) {
  return (op & 0xff) | ((a & 0xff) << 8) | ((b & 0xff) << 16) | ((c & 0xff) << 24);
}
function withBx(op, a, bx) {
  return (op & 0xff) | ((a & 0xff) << 8) | ((bx & 0xffff) << 16);
}
function withSBx(op, a, sbx) {
  return withBx(op, a, sbx + 32768);
}

class FuncState {
  constructor(parent = null) {
    this.parent = parent;
    this.code = [];
    this.k = [];
    this.kMap = new Map();
    this.p = [];
    this.upvalues = [];
    this.locals = [];
    this.blocks = [];
    this.numparams = 0;
    this.isvararg = false;
    this.maxstack = 0;
    this.nactvar = 0;
    this.pc = 0;
    this.breaks = [];
    this.continues = [];
  }
  emit(op, a, b, c) {
    this.code.push(insn(op, a, b, c));
    return this.code.length - 1;
  }
  emitBx(op, a, bx) {
    this.code.push(withBx(op, a, bx));
    return this.code.length - 1;
  }
  emitSBx(op, a, sbx) {
    this.code.push(withSBx(op, a, sbx));
    return this.code.length - 1;
  }
  here() {
    return this.code.length;
  }
  patchSBx(pc, target) {
    const i = this.code[pc];
    const op = i & 0xff;
    const a = (i >>> 8) & 0xff;
    this.code[pc] = withSBx(op, a, target - (pc + 1));
  }
  addK(v) {
    const key = typeof v === "string" ? "s:" + v : typeof v === "number" ? "n:" + v : "x:" + String(v);
    if (this.kMap.has(key)) return this.kMap.get(key);
    const idx = this.k.length;
    this.k.push(v);
    this.kMap.set(key, idx);
    return idx;
  }
  enterBlock(loop) {
    this.blocks.push({ nactvar: this.nactvar, loop, breaks: [], continues: [] });
  }
  leaveBlock() {
    const b = this.blocks.pop();
    this.nactvar = b.nactvar;
    while (this.locals.length > this.nactvar) this.locals.pop();
    return b;
  }
  loopBlock() {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].loop) return this.blocks[i];
    }
    return null;
  }
  addLocal(name) {
    const reg = this.nactvar;
    this.locals.push({ name, reg, captured: false });
    this.nactvar++;
    if (this.nactvar > this.maxstack) this.maxstack = this.nactvar;
    return reg;
  }
  findLocal(name) {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i].name === name && this.locals[i].reg < this.nactvar) return this.locals[i];
    }
    return null;
  }
  searchUpval(name) {
    if (!this.parent) return -1;
    const loc = this.parent.findLocal(name);
    if (loc) {
      loc.captured = true;
      return this.addUp(name, 1, loc.reg);
    }
    const pu = this.parent.searchUpval(name);
    if (pu < 0) return -1;
    return this.addUp(name, 0, pu);
  }
  addUp(name, instack, idx) {
    for (let i = 0; i < this.upvalues.length; i++) {
      const u = this.upvalues[i];
      if (u.instack === instack && u.idx === idx) return i;
    }
    this.upvalues.push({ name, instack, idx });
    return this.upvalues.length - 1;
  }
}

class Compiler {
  constructor(op) {
    this.OP = op;
  }
  compileChunk(ast) {
    const fs = new FuncState(null);
    fs.isvararg = true;
    this.body(fs, ast.body);
    fs.emit(this.OP.RETURN, 0, 1);
    return this.finish(fs);
  }
  finish(fs) {
    return {
      code: fs.code,
      k: fs.k,
      p: fs.p,
      upvalues: fs.upvalues,
      numparams: fs.numparams,
      isvararg: fs.isvararg ? 1 : 0,
      maxstack: Math.max(fs.maxstack, fs.numparams, 2),
    };
  }
  body(fs, stats) {
    fs.enterBlock(false);
    for (const s of stats) this.stat(fs, s);
    fs.leaveBlock();
  }
  stat(fs, s) {
    if (!s || s.type === "empty") return;
    switch (s.type) {
      case "local": return this.statLocal(fs, s);
      case "localfunc": return this.statLocalFunc(fs, s);
      case "assign": return this.statAssign(fs, s);
      case "compound": return this.statCompound(fs, s);
      case "callstat":
        this.exp(fs, s.exp, 0);
        return;
      case "do":
        fs.enterBlock(false);
        for (const x of s.body) this.stat(fs, x);
        fs.leaveBlock();
        return;
      case "if": return this.statIf(fs, s);
      case "while": return this.statWhile(fs, s);
      case "repeat": return this.statRepeat(fs, s);
      case "fornum": return this.statForNum(fs, s);
      case "forin": return this.statForIn(fs, s);
      case "funcstat": return this.statFunc(fs, s);
      case "return": return this.statReturn(fs, s);
      case "break": {
        const loop = fs.loopBlock();
        if (!loop) throw new Error("break outside loop");
        loop.breaks.push(fs.emitSBx(this.OP.JMP, 0, 0));
        return;
      }
      case "continue": {
        const loop = fs.loopBlock();
        if (!loop) throw new Error("continue outside loop");
        loop.continues.push(fs.emitSBx(this.OP.JMP, 0, 0));
        return;
      }
      case "goto":
      case "label":
        return;
      default:
        throw new Error("Unknown statement " + s.type);
    }
  }
  statLocal(fs, s) {
    const n = s.names.length;
    if (s.values.length === 1 && (s.values[0].type === "call" || s.values[0].type === "varargs")) {
      this.exp(fs, s.values[0], n);
    } else {
      for (let i = 0; i < n; i++) {
        if (i < s.values.length) this.exp(fs, s.values[i], 1);
        else fs.emit(this.OP.PUSHNIL);
      }
    }
    const regs = [];
    for (let i = 0; i < n; i++) regs.push(fs.addLocal(s.names[i]));
    for (let i = n - 1; i >= 0; i--) fs.emit(this.OP.SETLOCAL, regs[i]);
  }
  statLocalFunc(fs, s) {
    const reg = fs.addLocal(s.name);
    this.pushClosure(fs, s.fn);
    fs.emit(this.OP.SETLOCAL, reg);
  }
  statFunc(fs, s) {
    this.pushClosure(fs, s.fn);
    if (s.path.length === 1 && !s.method) {
      fs.emitBx(this.OP.SETGLOBAL, 0, fs.addK(s.path[0]));
      return;
    }
    this.exp(fs, { type: "name", name: s.path[0] }, 1);
    const last = s.method || s.path[s.path.length - 1];
    const limit = s.method ? s.path.length : s.path.length - 1;
    for (let i = 1; i < limit; i++) {
      fs.emitBx(this.OP.GETFIELD, 0, fs.addK(s.path[i]));
    }
    fs.emit(this.OP.SWAP);
    fs.emitBx(this.OP.SETFIELD, 0, fs.addK(last));
    fs.emit(this.OP.POP);
  }
  statAssign(fs, s) {
    const n = s.vars.length;
    if (s.values.length === 1 && (s.values[0].type === "call" || s.values[0].type === "varargs")) {
      this.exp(fs, s.values[0], n);
    } else {
      for (let i = 0; i < n; i++) {
        if (i < s.values.length) this.exp(fs, s.values[i], 1);
        else fs.emit(this.OP.PUSHNIL);
      }
      for (let i = s.values.length; i < n; i++);
    }
    for (let i = n - 1; i >= 0; i--) this.store(fs, s.vars[i]);
  }
  statCompound(fs, s) {
    this.loadTarget(fs, s.target);
    this.exp(fs, s.value, 1);
    const map = { "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD", "^": "POW", "..": "CONCAT", "//": "IDIV" };
    fs.emit(this.OP[map[s.op]]);
    this.store(fs, s.target);
  }
  loadTarget(fs, t) {
    if (t.type === "name") this.exp(fs, t, 1);
    else if (t.type === "field") {
      this.exp(fs, t.obj, 1);
      fs.emitBx(this.OP.GETFIELD, 0, fs.addK(t.name));
    } else if (t.type === "index") {
      this.exp(fs, t.obj, 1);
      this.exp(fs, t.key, 1);
      fs.emit(this.OP.GETTABLE);
    } else this.exp(fs, t, 1);
  }
  store(fs, t) {
    if (t.type === "name") {
      const r = this.resolve(fs, t.name);
      if (r.kind === "local") fs.emit(this.OP.SETLOCAL, r.idx);
      else if (r.kind === "upval") fs.emit(this.OP.SETUPVAL, r.idx);
      else fs.emitBx(this.OP.SETGLOBAL, 0, fs.addK(t.name));
    } else if (t.type === "field") {
      this.exp(fs, t.obj, 1);
      fs.emit(this.OP.SWAP);
      fs.emitBx(this.OP.SETFIELD, 0, fs.addK(t.name));
      fs.emit(this.OP.POP);
    } else if (t.type === "index") {
      this.exp(fs, t.obj, 1);
      fs.emit(this.OP.SWAP);
      this.exp(fs, t.key, 1);
      fs.emit(this.OP.SETTABLE);
      fs.emit(this.OP.POP);
    } else throw new Error("Invalid assignment target");
  }
  statIf(fs, s) {
    const endJumps = [];
    for (let i = 0; i < s.clauses.length; i++) {
      this.exp(fs, s.clauses[i].cond, 1);
      const jf = fs.emitSBx(this.OP.TESTF, 0, 0);
      fs.enterBlock(false);
      for (const st of s.clauses[i].body) this.stat(fs, st);
      fs.leaveBlock();
      if (i < s.clauses.length - 1 || s.elseBody) {
        endJumps.push(fs.emitSBx(this.OP.JMP, 0, 0));
      }
      fs.patchSBx(jf, fs.here());
    }
    if (s.elseBody) {
      fs.enterBlock(false);
      for (const st of s.elseBody) this.stat(fs, st);
      fs.leaveBlock();
    }
    for (const j of endJumps) fs.patchSBx(j, fs.here());
  }
  statWhile(fs, s) {
    fs.enterBlock(true);
    const loop = fs.loopBlock();
    const start = fs.here();
    this.exp(fs, s.cond, 1);
    const jf = fs.emitSBx(this.OP.TESTF, 0, 0);
    for (const st of s.body) this.stat(fs, st);
    const cont = fs.here();
    fs.emitSBx(this.OP.JMP, 0, start - (fs.here() + 1));
    fs.patchSBx(jf, fs.here());
    for (const b of loop.breaks) fs.patchSBx(b, fs.here());
    for (const c of loop.continues) fs.patchSBx(c, cont);
    fs.leaveBlock();
  }
  statRepeat(fs, s) {
    fs.enterBlock(true);
    const loop = fs.loopBlock();
    const start = fs.here();
    for (const st of s.body) this.stat(fs, st);
    const cont = fs.here();
    this.exp(fs, s.cond, 1);
    fs.emitSBx(this.OP.TESTF, 0, start - (fs.here() + 1));
    for (const b of loop.breaks) fs.patchSBx(b, fs.here());
    for (const c of loop.continues) fs.patchSBx(c, cont);
    fs.leaveBlock();
  }
  statForNum(fs, s) {
    this.exp(fs, s.from, 1);
    this.exp(fs, s.to, 1);
    if (s.step) this.exp(fs, s.step, 1);
    else {
      fs.emitSBx(this.OP.PUSHI, 0, 1);
    }
    const r0 = fs.addLocal("(" + s.name + "/i");
    const r1 = fs.addLocal("(" + s.name + "/l");
    const r2 = fs.addLocal("(" + s.name + "/s");
    fs.emit(this.OP.SETLOCAL, r2);
    fs.emit(this.OP.SETLOCAL, r1);
    fs.emit(this.OP.SETLOCAL, r0);
    const prep = fs.emitSBx(this.OP.FORPREP, r0, 0);
    fs.enterBlock(true);
    const loop = fs.loopBlock();
    const bodyStart = fs.here();
    const vr = fs.addLocal(s.name);
    for (const st of s.body) this.stat(fs, st);
    const loopIns = fs.here();
    fs.emitSBx(this.OP.FORLOOP, r0, bodyStart - (fs.here() + 1));
    fs.patchSBx(prep, loopIns);
    for (const b of loop.breaks) fs.patchSBx(b, fs.here());
    for (const c of loop.continues) fs.patchSBx(c, loopIns);
    fs.leaveBlock();
    void vr;
  }
  statForIn(fs, s) {
    const want = 3;
    if (s.iters.length === 1 && (s.iters[0].type === "call" || s.iters[0].type === "varargs")) {
      this.exp(fs, s.iters[0], want);
    } else {
      for (let i = 0; i < want; i++) {
        if (i < s.iters.length) this.exp(fs, s.iters[i], 1);
        else fs.emit(this.OP.PUSHNIL);
      }
    }
    const g = fs.addLocal("(gen");
    const stt = fs.addLocal("(state");
    const ctl = fs.addLocal("(ctl");
    fs.emit(this.OP.SETLOCAL, ctl);
    fs.emit(this.OP.SETLOCAL, stt);
    fs.emit(this.OP.SETLOCAL, g);
    const namesRegs = s.names.map((n) => fs.addLocal(n));
    void namesRegs;
    fs.enterBlock(true);
    const loop = fs.loopBlock();
    const jmp = fs.emitSBx(this.OP.JMP, 0, 0);
    const bodyStart = fs.here();
    for (const st of s.body) this.stat(fs, st);
    const tforPc = fs.here();
    fs.patchSBx(jmp, tforPc);
    fs.emit(this.OP.TFOR, g, s.names.length);
    const exitJ = fs.emitSBx(this.OP.TESTNIL, 0, 0);
    fs.emitSBx(this.OP.JMP, 0, bodyStart - (fs.here() + 1));
    fs.patchSBx(exitJ, fs.here());
    for (const b of loop.breaks) fs.patchSBx(b, fs.here());
    for (const c of loop.continues) fs.patchSBx(c, tforPc);
    fs.leaveBlock();
  }
  statReturn(fs, s) {
    if (s.values.length === 1 && s.values[0].type === "call") {
      this.exp(fs, s.values[0], -1);
      fs.emit(this.OP.RETURN, 0, 0);
      return;
    }
    for (const v of s.values) this.exp(fs, v, 1);
    fs.emit(this.OP.RETURN, s.values.length, 1);
  }
  resolve(fs, name) {
    const loc = fs.findLocal(name);
    if (loc) return { kind: "local", idx: loc.reg };
    if (fs.parent) {
      const u = fs.searchUpval(name);
      if (u >= 0) return { kind: "upval", idx: u };
    }
    return { kind: "global", idx: -1 };
  }
  pushClosure(fs, fn) {
    const child = new FuncState(fs);
    child.numparams = fn.params.length;
    child.isvararg = fn.vararg;
    for (const p of fn.params) child.addLocal(p);
    this.body(child, fn.body);
    child.emit(this.OP.RETURN, 0, 1);
    const proto = this.finish(child);
    const idx = fs.p.length;
    fs.p.push(proto);
    const extra = child.upvalues.map((u) => (u.instack ? 1 : 0) | (u.idx << 1));
    proto._updesc = extra;
    fs.emitBx(this.OP.CLOSURE, child.upvalues.length, idx);
  }
  exp(fs, node, nret) {
    if (!node) {
      if (nret > 0) for (let i = 0; i < nret; i++) fs.emit(this.OP.PUSHNIL);
      return;
    }
    switch (node.type) {
      case "nil":
        fs.emit(this.OP.PUSHNIL);
        break;
      case "bool":
        fs.emit(node.value ? this.OP.PUSHTRUE : this.OP.PUSHFALSE);
        break;
      case "number": {
        const v = node.value;
        if (Number.isInteger(v) && v >= -32767 && v <= 32767) fs.emitSBx(this.OP.PUSHI, 0, v);
        else fs.emitBx(this.OP.PUSHK, 0, fs.addK(v));
        break;
      }
      case "string":
        fs.emitBx(this.OP.PUSHK, 0, fs.addK(node.value));
        break;
      case "varargs":
        fs.emit(this.OP.VARARG, nret < 0 ? 0 : (nret || 1));
        return;
      case "name": {
        const r = this.resolve(fs, node.name);
        if (r.kind === "local") fs.emit(this.OP.GETLOCAL, r.idx);
        else if (r.kind === "upval") fs.emit(this.OP.GETUPVAL, r.idx);
        else fs.emitBx(this.OP.GETGLOBAL, 0, fs.addK(node.name));
        break;
      }
      case "field":
        this.exp(fs, node.obj, 1);
        fs.emitBx(this.OP.GETFIELD, 0, fs.addK(node.name));
        break;
      case "index":
        this.exp(fs, node.obj, 1);
        this.exp(fs, node.key, 1);
        fs.emit(this.OP.GETTABLE);
        break;
      case "unop":
        this.exp(fs, node.arg, 1);
        fs.emit(this.OP[{ not: "NOT", "-": "UNM", "#": "LEN", "~": "BNOT" }[node.op]]);
        break;
      case "binop":
        this.expBin(fs, node);
        break;
      case "call":
        this.expCall(fs, node, nret);
        return;
      case "table":
        this.expTable(fs, node);
        break;
      case "function":
        this.pushClosure(fs, node);
        break;
      case "ifexp":
        this.exp(fs, node.cond, 1);
        {
          const jf = fs.emitSBx(this.OP.TESTF, 0, 0);
          this.exp(fs, node.then, 1);
          const je = fs.emitSBx(this.OP.JMP, 0, 0);
          fs.patchSBx(jf, fs.here());
          this.exp(fs, node.else, 1);
          fs.patchSBx(je, fs.here());
        }
        break;
      default:
        throw new Error("Unknown exp " + node.type);
    }
    this.adjust(fs, 1, nret);
  }
  adjust(fs, have, want) {
    if (want < 0 || want === undefined) return;
    if (have === want) return;
    if (have > want) {
      for (let i = 0; i < have - want; i++) fs.emit(this.OP.POP);
    } else {
      for (let i = 0; i < want - have; i++) fs.emit(this.OP.PUSHNIL);
    }
  }
  expBin(fs, node) {
    if (node.op === "and") {
      this.exp(fs, node.left, 1);
      const j = fs.emitSBx(this.OP.ANDSKIP, 0, 0);
      this.exp(fs, node.right, 1);
      fs.patchSBx(j, fs.here());
      return;
    }
    if (node.op === "or") {
      this.exp(fs, node.left, 1);
      const j = fs.emitSBx(this.OP.ORSKIP, 0, 0);
      this.exp(fs, node.right, 1);
      fs.patchSBx(j, fs.here());
      return;
    }
    this.exp(fs, node.left, 1);
    this.exp(fs, node.right, 1);
    const map = {
      "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD", "^": "POW",
      "..": "CONCAT", "//": "IDIV", "==": "EQ", "~=": "NE", "<": "LT", "<=": "LE",
      ">": "GT", ">=": "GE", "&": "BAND", "|": "BOR",
    };
    if (node.op === "<<") fs.emit(this.OP.SHL);
    else if (node.op === ">>") fs.emit(this.OP.SHR);
    else fs.emit(this.OP[map[node.op]]);
  }
  expCall(fs, node, nret) {
    if (node.method) {
      this.exp(fs, node.func, 1);
      fs.emitBx(this.OP.SELF, 0, fs.addK(node.method));
      for (const a of node.args) this.exp(fs, a, 1);
    } else {
      this.exp(fs, node.func, 1);
      for (const a of node.args) this.exp(fs, a, 1);
    }
    const want = nret < 0 ? 0 : nret === undefined ? 2 : nret + 1;
    fs.emit(this.OP.CALL, node.args.length + (node.method ? 1 : 0), want);
  }
  expTable(fs, node) {
    fs.emit(this.OP.NEWTABLE);
    let arr = 0;
    for (const f of node.fields) {
      if (f.rec) {
        this.exp(fs, f.value, 1);
        if (f.key.type === "string") fs.emitBx(this.OP.SETFIELD, 0, fs.addK(f.key.value));
        else {
          this.exp(fs, f.key, 1);
          fs.emit(this.OP.SETTABLE);
        }
      } else {
        this.exp(fs, f.value, 1);
        arr++;
        fs.emitSBx(this.OP.PUSHI, 0, arr);
        fs.emit(this.OP.SETTABLE);
      }
    }
  }
}

/* ---------- LZ4-ish (independent block, same shape as SwaveArmor u5) ---------- */
function lz4Compress(src) {
  const out = [];
  const n = src.length;
  const hash = new Map();
  let i = 0;
  while (i < n) {
    const litStart = i;
    let matchOff = 0, matchLen = 0;
    while (i < n) {
      if (i + 4 <= n) {
        const h = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
        const bucket = hash.get(h) || [];
        for (let b = bucket.length - 1; b >= 0; b--) {
          const p = bucket[b];
          const dist = i - p;
          if (dist <= 0 || dist > 65535) continue;
          let l = 0;
          while (i + l < n && src[p + l] === src[i + l] && l < 65535) l++;
          if (l >= 4 && l > matchLen) {
            matchLen = l;
            matchOff = dist;
          }
        }
        bucket.push(i);
        if (bucket.length > 8) bucket.shift();
        hash.set(h, bucket);
      }
      if (matchLen >= 4) break;
      i++;
    }
    const litLen = (matchLen >= 4 ? i : n) - litStart;
    if (matchLen < 4) {
      let tokenLit = litLen;
      const token = ((Math.min(tokenLit, 15)) << 4);
      out.push(token);
      tokenLit -= Math.min(litLen, 15);
      if (litLen >= 15) {
        while (tokenLit >= 255) {
          out.push(255);
          tokenLit -= 255;
        }
        out.push(tokenLit);
      }
      for (let k = 0; k < litLen; k++) out.push(src[litStart + k]);
      break;
    }
    let ll = litLen, ml = matchLen - 4;
    let token = (Math.min(ll, 15) << 4) | Math.min(ml, 15);
    out.push(token);
    ll -= Math.min(litLen, 15);
    if (litLen >= 15) {
      while (ll >= 255) {
        out.push(255);
        ll -= 255;
      }
      out.push(ll);
    }
    for (let k = 0; k < litLen; k++) out.push(src[litStart + k]);
    out.push(matchOff & 0xff);
    out.push((matchOff >>> 8) & 0xff);
    ml -= Math.min(matchLen - 4, 15);
    if (matchLen - 4 >= 15) {
      while (ml >= 255) {
        out.push(255);
        ml -= 255;
      }
      out.push(ml);
    }
    i += matchLen;
  }
  return Uint8Array.from(out);
}

function xorBytes(buf, key) {
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

const SAFE_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<>?@^_`{|}~";

function makeAlphabet() {
  return shuffle(SAFE_ALPHA.split("")).join("").slice(0, 64);
}

function encodeAlphabet(bytes, alpha) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += alpha[(n >>> 18) & 63] + alpha[(n >>> 12) & 63] + alpha[(n >>> 6) & 63] + alpha[n & 63];
  }
  const pad = (3 - (bytes.length % 3)) % 3;
  return { s, pad, extra: bytes.length };
}

function serializeProto(proto) {
  const chunks = [];
  const u8 = (n) => chunks.push(n & 0xff);
  const u16 = (n) => {
    u8(n);
    u8(n >>> 8);
  };
  const u32 = (n) => {
    u8(n);
    u8(n >>> 8);
    u8(n >>> 16);
    u8(n >>> 24);
  };
  const writeStr = (str) => {
    const b = utf8Encode(str);
    u32(b.length);
    for (let i = 0; i < b.length; i++) u8(b[i]);
  };
  const walk = (p) => {
    u8(p.numparams);
    u8(p.isvararg);
    u8(p.maxstack);
    u8(p.upvalues.length);
    u16(p.k.length);
    u32(p.code.length);
    u16(p.p.length);
    for (const u of p.upvalues) {
      u8(u.instack ? 1 : 0);
      u8(u.idx);
    }
    for (const c of p.k) {
      if (c === null || c === undefined) u8(0);
      else if (typeof c === "boolean") {
        u8(1);
        u8(c ? 1 : 0);
      } else if (typeof c === "number") {
        if (Number.isInteger(c) && c >= -2147483648 && c <= 2147483647) {
          u8(2);
          u32(c >>> 0);
        } else {
          u8(3);
          writeStr(String(c));
        }
      } else {
        u8(4);
        writeStr(String(c));
      }
    }
    for (const ins of p.code) u32(ins >>> 0);
    for (const ch of p.p) walk(ch);
  };
  walk(proto);
  return Uint8Array.from(chunks);
}

function utf8Encode(str) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

function luaStr(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
}

function identPool() {
  const letters = "vumfKphJZbjHCYz nSwaABDEFLMNOPQRTVWXcdegklqrstx".replace(/ /g, "").split("");
  const used = new Set([
    "if", "then", "end", "do", "and", "or", "not", "local", "function", "return",
    "for", "while", "repeat", "until", "break", "in", "nil", "true", "false",
    "else", "elseif", "goto", "continue", "type", "export", "self",
  ]);
  let n = 0;
  return () => {
    let name;
    do {
      if (n < letters.length) name = letters[n];
      else {
        const i = n - letters.length;
        name = letters[i % letters.length] + Math.floor(i / letters.length);
      }
      n++;
    } while (used.has(name) || !/^[A-Za-z]/.test(name));
    used.add(name);
    return name;
  };
}

function generateVM(proto, options) {
  const op = options.op;
  const id = identPool();
  const names = {
    ru8: id(), ru16: id(), ru32: id(), rstr: id(),
    wu8: id(), w32: id(), bcreate: id(), bfill: id(), bcopy: id(), btostring: id(),
    bxor: id(), band: id(), bor: id(), bnot: id(), rshift: id(), lshift: id(),
    tcreate: id(), tinsert: id(), unpack: id(), tconcat: id(), tpack: id(), tclear: id(),
    sbyte: id(), ssub: id(), schar: id(),
    floor: id(), max: id(),
    typ: id(), pcall: id(), select: id(), tonumber: id(),
    err: id(),
    env: id(), stash: id(),
    codeBuf: id(), constBuf: id(),
    decode: id(), exec: id(), kill: id(),
    payload: id(),
    topEnv: id(), genv: id(),
  };

  const alpha = makeAlphabet();
  const raw = serializeProto(proto);
  const compressed = lz4Compress(raw);
  const xorKey = [randomInt(1, 255), randomInt(1, 255), randomInt(1, 255), randomInt(1, 255)];
  const xored = xorBytes(compressed, xorKey);
  const enc = encodeAlphabet(xored, alpha);
  const eq = "=".repeat(randomInt(2, 5));

  const OPN = (name) => op[name];

  const handler = {
    PUSHNIL: `S=S+1;R[S]=nil`,
    PUSHTRUE: `S=S+1;R[S]=true`,
    PUSHFALSE: `S=S+1;R[S]=false`,
    PUSHK: `S=S+1;R[S]=K[Bx+1]`,
    PUSHI: `S=S+1;R[S]=sBx`,
    GETLOCAL: `S=S+1;do local _b=Bxes[A];if _b then R[S]=_b.v else R[S]=L[A]end end`,
    SETLOCAL: `do local _v=R[S];S=S-1;local _b=Bxes[A];if _b then _b.v=_v end;L[A]=_v end`,
    GETUPVAL: `S=S+1;R[S]=UV[A+1].v`,
    SETUPVAL: `UV[A+1].v=R[S];S=S-1`,
    GETGLOBAL: `S=S+1;R[S]=ENV[K[Bx+1]]`,
    SETGLOBAL: `ENV[K[Bx+1]]=R[S];S=S-1`,
    GETTABLE: `do local _k=R[S];S=S-1;R[S]=R[S][_k]end`,
    SETTABLE: `do local _k=R[S];local _v=R[S-1];S=S-2;R[S][_k]=_v end`,
    GETFIELD: `R[S]=R[S][K[Bx+1]]`,
    SETFIELD: `do local _v=R[S];S=S-1;R[S][K[Bx+1]]=_v end`,
    SELF: `do local _o=R[S];S=S+1;R[S]=_o;R[S-1]=_o[K[Bx+1]]end`,
    NEWTABLE: `S=S+1;R[S]={}`,
    ADD: `R[S-1]=R[S-1]+R[S];S=S-1`,
    SUB: `R[S-1]=R[S-1]-R[S];S=S-1`,
    MUL: `R[S-1]=R[S-1]*R[S];S=S-1`,
    DIV: `R[S-1]=R[S-1]/R[S];S=S-1`,
    MOD: `R[S-1]=R[S-1]%R[S];S=S-1`,
    POW: `R[S-1]=R[S-1]^R[S];S=S-1`,
    IDIV: `R[S-1]=${names.floor}(R[S-1]/R[S]);S=S-1`,
    CONCAT: `R[S-1]=R[S-1]..R[S];S=S-1`,
    BAND: `R[S-1]=${names.band}(R[S-1],R[S]);S=S-1`,
    BOR: `R[S-1]=${names.bor}(R[S-1],R[S]);S=S-1`,
    BXOR: `R[S-1]=${names.bxor}(R[S-1],R[S]);S=S-1`,
    SHL: `R[S-1]=${names.lshift}(R[S-1],R[S]);S=S-1`,
    SHR: `R[S-1]=${names.rshift}(R[S-1],R[S]);S=S-1`,
    UNM: `R[S]=-R[S]`,
    NOT: `R[S]=not R[S]`,
    LEN: `R[S]=#R[S]`,
    BNOT: `R[S]=${names.bnot}(R[S])`,
    EQ: `R[S-1]=R[S-1]==R[S];S=S-1`,
    NE: `R[S-1]=R[S-1]~=R[S];S=S-1`,
    LT: `R[S-1]=R[S-1]<R[S];S=S-1`,
    LE: `R[S-1]=R[S-1]<=R[S];S=S-1`,
    GT: `R[S-1]=R[S-1]>R[S];S=S-1`,
    GE: `R[S-1]=R[S-1]>=R[S];S=S-1`,
    JMP: `pc=pc+sBx`,
    TESTF: `do local _v=R[S];S=S-1;if not _v then pc=pc+sBx end end`,
    TESTT: `do local _v=R[S];S=S-1;if _v then pc=pc+sBx end end`,
    TESTNIL: `do local _v=R[S];S=S-1;if _v==nil then pc=pc+sBx end end`,
    ANDSKIP: `if not R[S] then pc=pc+sBx else S=S-1 end`,
    ORSKIP: `if R[S] then pc=pc+sBx else S=S-1 end`,
    CALL: `do local _na=A;local _nr=B;local _base=S-_na;local _fn=R[_base];local _a=${names.tcreate}(_na);for _i=1,_na do _a[_i]=R[_base+_i]end;S=_base-1;if _nr==0 then local _r=${names.tpack}(_fn(${names.unpack}(_a,1,_na)));for _i=1,_r.n do S=S+1;R[S]=_r[_i]end elseif _nr==1 then _fn(${names.unpack}(_a,1,_na)) else local _r={_fn(${names.unpack}(_a,1,_na))};for _i=1,_nr-1 do S=S+1;R[S]=_r[_i]end end end`,
    RETURN: `do local _n=A;if B==0 then local _o=S;local _t=${names.tcreate}(_o);for _i=1,_o do _t[_i]=R[_i]end;return ${names.unpack}(_t,1,_o) elseif _n==0 then return else local _t=${names.tcreate}(_n);for _i=1,_n do _t[_i]=R[S-_n+_i]end;return ${names.unpack}(_t,1,_n)end end`,
    FORPREP: `do L[A]=L[A]-L[A+2];pc=pc+sBx end`,
    FORLOOP: `do L[A]=L[A]+L[A+2];local _s=L[A+2];if(_s>=0 and L[A]<=L[A+1])or(_s<0 and L[A]>=L[A+1])then pc=pc+sBx;L[A+3]=L[A];local _b=Bxes[A+3];if _b then _b.v=L[A]end end end`,
    TFOR: `do local _g=L[A];local _n=B;local _res=${names.tpack}(_g(L[A+1],L[A+2]));for _i=1,_n do local _ri=A+2+_i;L[_ri]=_res[_i];local _bx=Bxes[_ri];if _bx then _bx.v=_res[_i]end end;if _res[1]~=nil then L[A+2]=_res[1]end;S=S+1;R[S]=_res[1]end`,
    CLOSURE: `do local _pr=P[Bx+1];local _uv=${names.tcreate}(A);for _i=1,A do local _d=_pr.u[_i];if _d.s==1 then local _b=Bxes[_d.i];if not _b then _b={v=L[_d.i]};Bxes[_d.i]=_b end;_uv[_i]=_b else _uv[_i]=UV[_d.i+1]end end;S=S+1;R[S]=${names.exec}(_pr,_uv,ENV)end`,
    VARARG: `do local _n=A;if _n==0 then for _i=1,#VA do S=S+1;R[S]=VA[_i]end else for _i=1,_n do S=S+1;R[S]=VA[_i]end end end`,
    POP: `R[S]=nil;S=S-1`,
    DUP: `S=S+1;R[S]=R[S-1]`,
    CLOSE: `for _i=A,#Bxes do Bxes[_i]=nil end`,
    SWAP: `do local _t=R[S];R[S]=R[S-1];R[S-1]=_t end`,
    LOADBOOL: `S=S+1;R[S]=A~=0`,
  };

  const opEntries = BASE_OPS.map((name) => ({ name, code: OPN(name), body: handler[name] }));
  opEntries.sort((a, b) => a.code - b.code);

  function dispatchTree(list) {
    if (list.length === 0) return `${names.kill}()`;
    if (list.length === 1) {
      const e = list[0];
      const mask = randomInt(1, 250);
      const want = (e.code ^ mask) & 0xff;
      return `if ${names.bxor}(op,${mask})==${want} then ${e.body} else ${names.kill}()end`;
    }
    if (list.length === 2) {
      const [a, b] = list;
      return `if op==${a.code} then ${a.body} elseif op==${b.code} then ${b.body} else ${names.kill}()end`;
    }
    const mid = Math.floor(list.length / 2);
    const pivot = list[mid].code;
    const left = list.filter((x) => x.code < pivot);
    const right = list.filter((x) => x.code >= pivot);
    if (left.length === 0) return dispatchTree(right);
    return `if op<${pivot} then ${dispatchTree(left)} else ${dispatchTree(right)}end`;
  }

  const dispatch = dispatchTree(opEntries);
  const invite = options.discordInvite ? " " + options.discordInvite : "";
  const xorLua = xorKey.join(",");
  const alphaLua = luaStr(alpha);
  const pad = enc.pad;
  const rawLen = compressed.length;

  const parts = [];
  parts.push(`-- This script was protected using ${PRODUCT} ${VERSION}${invite}`);
  parts.push(`return(function(...)`);
  parts.push(`if buffer==nil then local _B={} local function _c(n)local t={n=n}for i=0,n-1 do t[i]=0 end return t end local function _r8(b,o)return b[o]or 0 end local function _w8(b,o,v)b[o]=v%256 end local function _r16(b,o)return _r8(b,o)+_r8(b,o+1)*256 end local function _r32(b,o)return _r8(b,o)+_r8(b,o+1)*256+_r8(b,o+2)*65536+_r8(b,o+3)*16777216 end local function _rs(b,o,n)local t={}for i=1,n do t[i]=string.char(_r8(b,o+i-1))end return table.concat(t)end local function _cp(d,doff,s,soff,n)for i=0,n-1 do _w8(d,doff+i,_r8(s,soff+i))end end buffer={create=_c,readu8=_r8,readu16=_r16,readu32=_r32,readstring=_rs,writeu8=_w8,writeu32=function(b,o,v)_w8(b,o,v)_w8(b,o+1,math.floor(v/256))_w8(b,o+2,math.floor(v/65536))_w8(b,o+3,math.floor(v/16777216))end,fill=function(b,o,v,n)for i=0,n-1 do _w8(b,o+i,v)end end,copy=_cp,tostring=function(b)return _rs(b,0,b.n or #b)end} end`);
  parts.push(`local ${names.ru8},${names.ru16},${names.ru32},${names.rstr}=buffer.readu8,buffer.readu16,buffer.readu32,buffer.readstring`);
  parts.push(`local ${names.wu8},${names.w32},${names.bcreate},${names.bfill},${names.bcopy},${names.btostring}=buffer.writeu8,buffer.writeu32,buffer.create,buffer.fill,buffer.copy,buffer.tostring`);
  parts.push(`local ${names.bxor},${names.band},${names.bor},${names.bnot},${names.rshift},${names.lshift}=bit32.bxor,bit32.band,bit32.bor,bit32.bnot,bit32.rshift,bit32.lshift`);
  parts.push(`local ${names.tcreate},${names.tinsert},${names.unpack},${names.tconcat},${names.tpack},${names.tclear}=table.create,table.insert,table.unpack or unpack,table.concat,table.pack,table.clear`);
  parts.push(`local ${names.sbyte},${names.ssub},${names.schar}=string.byte,string.sub,string.char`);
  parts.push(`local ${names.floor},${names.max}=math.floor,math.max`);
  parts.push(`local ${names.typ},${names.pcall},${names.select},${names.tonumber}=type,pcall,select,tonumber`);
  parts.push(`local ${names.err}=error`);
  parts.push(`local ${names.topEnv}=(type(getfenv)=="function"and(getfenv(0)or getfenv()))or(type(getgenv)=="function"and getgenv())or _G`);
  parts.push(`local ${names.genv}=(type(getgenv)=="function"and getgenv())or ${names.topEnv}`);
  parts.push(`local ${names.stash}={}`);
  parts.push(`local ${names.env}=setmetatable({},{__index=function(_,k)local v=${names.stash}[k]if v~=nil then return v end if ${names.topEnv}~=nil then v=${names.topEnv}[k]if v~=nil then return v end end if ${names.genv}~=nil then v=${names.genv}[k]if v~=nil then return v end end if _G~=nil then return _G[k]end return nil end,__newindex=function(_,k,v)${names.stash}[k]=v if ${names.topEnv}~=nil then ${names.pcall}(function()${names.topEnv}[k]=v end)end end,__metatable="The metatable is locked"})`);
  parts.push(`local function ${names.kill}()${names.err}("",0)end`);
  parts.push(`if ${names.bxor}(1,1)~=0 or ${names.typ}(${names.pcall})~="function" then ${names.kill}()end`);

  parts.push(`local _A=${alphaLua}`);
  parts.push(`local _P=[${eq}[${enc.s}]${eq}]`);
  parts.push(`local _K={${xorLua}}`);
  parts.push(`local function _dec(s)`);
  parts.push(`local n=#s local out=${names.tcreate}(${names.floor}(n/4)*3) local o=0 local map={} for i=1,64 do map[${names.ssub}(_A,i,i)]=i-1 end`);
  parts.push(`for i=1,n,4 do local a=map[${names.ssub}(s,i,i)]or 0 local b=map[${names.ssub}(s,i+1,i+1)]or 0 local c=map[${names.ssub}(s,i+2,i+2)]or 0 local d=map[${names.ssub}(s,i+3,i+3)]or 0 local v=${names.lshift}(a,18)+${names.lshift}(b,12)+${names.lshift}(c,6)+d o=o+1 out[o]=${names.band}(${names.rshift}(v,16),255) o=o+1 out[o]=${names.band}(${names.rshift}(v,8),255) o=o+1 out[o]=${names.band}(v,255) end`);
  parts.push(`local L=${rawLen} local buf=${names.bcreate}(L) for i=1,L do ${names.wu8}(buf,i-1,${names.bxor}(out[i],_K[((i-1)%4)+1]))end return buf,L end`);

  parts.push(`local function _lz4(src,sn,dst,dn)`);
  parts.push(`local i,o=0,0 while i<sn and o<dn do local t=${names.ru8}(src,i) i=i+1 local ll=${names.rshift}(t,4) if ll==15 then local n=255 while n==255 do n=${names.ru8}(src,i) i=i+1 ll=ll+n end end if ll>0 then ${names.bcopy}(dst,o,src,i,ll) i=i+ll o=o+ll end if i>=sn or o>=dn then break end local off=${names.ru16}(src,i) i=i+2 local ml=${names.band}(t,15)+4 if ml==19 then local n=255 while n==255 do n=${names.ru8}(src,i) i=i+1 ml=ml+n end end local m=o-off if off>=ml then ${names.bcopy}(dst,o,dst,m,ml) else for k=0,ml-1 do ${names.wu8}(dst,o+k,${names.ru8}(dst,m+k))end end o=o+ml end end`);

  parts.push(`local _src,_sn=_dec(_P)`);
  parts.push(`local _dst=${names.bcreate}(${raw.length})`);
  parts.push(`_lz4(_src,_sn,_dst,${raw.length})`);
  parts.push(`local _pos=0`);
  parts.push(`local function _u8()local x=${names.ru8}(_dst,_pos)_pos=_pos+1 return x end`);
  parts.push(`local function _u16()local x=${names.ru16}(_dst,_pos)_pos=_pos+2 return x end`);
  parts.push(`local function _u32()local x=${names.ru32}(_dst,_pos)_pos=_pos+4 return x end`);
  parts.push(`local function _str()local n=_u32()local s=${names.rstr}(_dst,_pos,n)_pos=_pos+n return s end`);
  parts.push(`local function _i32()local x=_u32()if x>=2147483648 then return x-4294967296 end return x end`);

  parts.push(`local function _readP()`);
  parts.push(`local p={n=_u8(),v=_u8(),m=_u8(),nu=_u8()} local nk=_u16() local nc=_u32() local np=_u16()`);
  parts.push(`p.u=${names.tcreate}(p.nu) for i=1,p.nu do p.u[i]={s=_u8(),i=_u8()}end`);
  parts.push(`p.k=${names.tcreate}(nk) for i=1,nk do local t=_u8() if t==0 then p.k[i]=nil elseif t==1 then p.k[i]=_u8()~=0 elseif t==2 then p.k[i]=_i32() elseif t==3 then p.k[i]=${names.tonumber}(_str()) else p.k[i]=_str() end end`);
  parts.push(`p.c=${names.tcreate}(nc) for i=1,nc do p.c[i]=_u32()end`);
  parts.push(`p.p=${names.tcreate}(np) for i=1,np do p.p[i]=_readP()end`);
  parts.push(`return p end`);
  parts.push(`local _root=_readP()`);

  parts.push(`local function ${names.exec}(pr,UV,ENV)`);
  parts.push(`return function(...)`);
  parts.push(`local L=${names.tcreate}(pr.m) local Bxes={} local R=${names.tcreate}(64) local S=0 local K=pr.k local P=pr.p local VA={...}`);
  parts.push(`local argc=${names.select}("#",...)`);
  parts.push(`for i=1,pr.n do L[i-1]=VA[i]end`);
  parts.push(`if pr.v~=0 then local nva=${names.tcreate}(${names.max}(0,argc-pr.n)) for i=pr.n+1,argc do nva[i-pr.n]=VA[i]end VA=nva else VA={} end`);
  parts.push(`local pc=1 local code=pr.c local ncode=#code`);
  parts.push(`while pc<=ncode do`);
  parts.push(`local ins=code[pc] pc=pc+1`);
  parts.push(`local op=${names.band}(ins,255) local A=${names.band}(${names.rshift}(ins,8),255) local B=${names.band}(${names.rshift}(ins,16),255) local C=${names.band}(${names.rshift}(ins,24),255) local Bx=${names.rshift}(ins,16) local sBx=Bx-32768`);
  parts.push(dispatch);
  parts.push(`end end end`);
  parts.push(`return ${names.exec}(_root,{},${names.env})(...)`);
  parts.push(`end)(...)`);
  return parts.join("");
}

function makeOpMap() {
  const ids = shuffle(BASE_OPS.map((_, i) => i + 1));
  const op = {};
  BASE_OPS.forEach((n, i) => {
    op[n] = ids[i];
  });
  return op;
}

function compileSource(source) {
  const tokens = tokenize(source);
  const ast = new Parser(tokens).parseChunk();
  const op = makeOpMap();
  const proto = new Compiler(op).compileChunk(ast);
  return { proto, op };
}

function obfuscate(source, discordInvite) {
  if (!source || typeof source !== "string") throw new Error("Source must be a non-empty string");
  const src = source.replace(/^\uFEFF/, "");
  try {
    const { proto, op } = compileSource(src);
    return generateVM(proto, { op, discordInvite: discordInvite || "" });
  } catch (err) {
    return generateCompatible(src, discordInvite || "", err);
  }
}

function safeMinify(source) {
  const tokens = tokenize(source);
  let out = "";
  let prev = null;
  const needSpace = (a, b) => {
    if (!a) return false;
    const aw = a.type === "KW" || a.type === "IDENT" || a.type === "NUMBER";
    const bw = b.type === "KW" || b.type === "IDENT" || b.type === "NUMBER";
    return aw && bw;
  };
  for (const t of tokens) {
    if (t.type === "EOF") break;
    if (needSpace(prev, t)) out += " ";
    if (t.type === "STRING") {
      const q = t.value.includes('"') && !t.value.includes("'") ? "'" : '"';
      const body = t.value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
      out += q === '"' ? `"${body.replace(/"/g, '\\"')}"` : `'${body.replace(/'/g, "\\'")}'`;
    } else {
      out += t.value;
    }
    prev = t;
  }
  return out;
}

function generateCompatible(source, discordInvite, parseErr) {
  const min = safeMinify(source);
  const invite = discordInvite ? " " + discordInvite : "";
  return `-- This script was protected using ${PRODUCT} ${VERSION}${invite}
return(function(...)
local _Genv=(type(getfenv)=="function"and(getfenv(0)or getfenv()))or(type(getgenv)=="function"and getgenv())or _G
local function __payload(...)
${min}
end
return __payload(...)
end)(...)`;
}

export { obfuscate, compileSource, VERSION, PRODUCT };


if (typeof module !== "undefined" && module.exports) {
  module.exports = { obfuscate, compileSource, VERSION, PRODUCT };
}
