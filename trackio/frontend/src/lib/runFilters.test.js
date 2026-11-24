import { expect, it } from "vitest";
import { configFilterKeys, configValueChoices, compileConfigFilter, filterRunsByConfig, filterRunsByName, parseConfigFilters } from "./runFilters.js";
const rule = (key, value, operator = "=") => ({ key: JSON.stringify(key), value, operator });
it("matches OR groups of AND conditions by ID despite duplicate names", () => {
  const runs = Array.from({ length: 4 }, (_, id) => ({ id, name: "same" }));
  const configs = Object.fromEntries(runs.map((run, i) => [run.id, { batch_size: i < 2 ? 32 : 64, optimizer: i % 2 ? "sgd" : "adam" }]));
  const match = compileConfigFilter([[rule(["batch_size"], "32"), rule(["optimizer"], "adam")], [rule(["batch_size"], "64"), rule(["optimizer"], "sgd")]]);
  expect(filterRunsByConfig(runs, configs, match)).toEqual([runs[0], runs[3]]);
});
it("distinguishes nested paths from literal dotted keys", () => {
  const config = { dataset: { augment: true }, "dataset.augment": false, _private: 1, list: [1], nullable: null };
  expect(configFilterKeys({ a: config }).map((key) => JSON.parse(key.value))).toEqual([["dataset.augment"], ["dataset", "augment"], ["nullable"]]);
  expect(configFilterKeys({ a: config }).map((key) => key.label)).toEqual(['["dataset.augment"]', "dataset.augment", "nullable"]);
  expect(compileConfigFilter([[rule(["dataset", "augment"], "true")]])(config)).toBe(true);
  expect(compileConfigFilter([[rule(["dataset.augment"], "true")]])(config)).toBe(false);
});
it.each([">", ">=", "<", "<="])("compares numbers using %s without coercing other types", (operator) => {
  const match = compileConfigFilter([[rule(["size"], "32", operator)]]);
  const number = operator.startsWith(">") ? 64 : 16;
  expect(match({ size: number })).toBe(true);
  expect(match({ size: String(number) })).toBe(false);
  expect(match({ size: null })).toBe(false);
  expect(compileConfigFilter([[rule(["size"], "", operator)]])({ size: number })).toBe(false);
});
it("handles missing keys, nulls, empty strings, inequality and contains", () => {
  expect(compileConfigFilter([[rule(["a"], "x", "!=")]])({})).toBe(false);
  expect(compileConfigFilter([[rule(["a"], "null")]])({ a: null })).toBe(true);
  expect(compileConfigFilter([[rule(["a"], "32.0")]])({ a: 32 })).toBe(true);
  expect(compileConfigFilter([[rule(["a"], "")]])({ a: "" })).toBe(true);
  expect(compileConfigFilter([[rule(["a"], "adam", "contains")]])({ a: "adamw" })).toBe(true);
  expect(compileConfigFilter([[rule(["a"], "2", "contains")]])({ a: 32 })).toBe(false);
});
it("ignores unfinished rows and supports legacy configs", () => {
  const runs = [{ name: "legacy" }];
  const groups = [[{ key: "", value: "", operator: "=" }]];
  expect(filterRunsByConfig(runs, {}, compileConfigFilter(groups))).toEqual(runs);
  groups.push([rule(["size"], "32")]);
  expect(filterRunsByConfig(runs, { legacy: { size: 64 } }, compileConfigFilter(groups))).toEqual([]);
  expect(filterRunsByConfig(runs, { legacy: { size: 32 } }, compileConfigFilter(groups))).toEqual(runs);
});

it("round trips filter URLs and rejects malformed rules", () => {
  const groups = [[rule(["nested", "key"], "32")]];
  expect(parseConfigFilters(JSON.stringify(groups))).toEqual(groups);
  for (const value of [null, "bad json", "{}", '[null]', '[[{}]]', '[[{"key":"{}","value":"x","operator":"="}]]']) {
    expect(parseConfigFilters(value)).toEqual([]);
  }
});
it("combines name and configuration filters without changing run identities", () => {
  const runs = [{ id: "a", name: "train" }, { id: "b", name: "eval" }, { id: "c", name: "train" }];
  const configs = { a: { size: 32 }, b: { size: 32 }, c: { size: 64 } };
  expect(filterRunsByConfig(filterRunsByName(runs, "TRAIN"), configs, compileConfigFilter([[rule(["size"], "32")]]))).toEqual([runs[0]]);
});

it("matches typed IN members without coercion, including null and missing values", () => {
  const match = compileConfigFilter([[{key:'["x"]', operator:"IN", value:'[1,true,null,"one"]'}]]);
  for (const x of [1,true,null,"one"]) expect(match({x})).toBe(true);
  for (const x of ["1",false,2]) expect(match({x})).toBe(false);
  expect(match({})).toBe(false);
  expect(compileConfigFilter([[{key:'["x"]', operator:"IN", value:"[]"}]])({x:1})).toBe(false);
});

it("unifies filter fields, values and matching across flat and nested configs", () => {
  const configs = {
    a: {"env_args.compile_transition": true},
    b: {env_args: {compile_transition: false}},
    c: {env_args: {compile_transition: true}, "env_args.compile_transition": true},
    d: {},
  };
  const key = JSON.stringify(["env_args", "compile_transition"]);
  expect(configFilterKeys(configs)).toEqual([{value:key,label:"env_args.compile_transition"}]);
  expect(configValueChoices(configs, key).map((choice) => choice.token)).toEqual(["false", "true"]);
  const runs = Object.keys(configs).map((id) => ({id, name:id}));
  for (const [operator, value] of [["=", "true"], ["IN", "[true]"]]) {
    const match = compileConfigFilter([[{key,operator,value}]], configs);
    expect(filterRunsByConfig(runs, configs, match).map((run) => run.id)).toEqual(["a", "c"]);
  }
  expect(configFilterKeys(configs, {includeAliases:true})).toHaveLength(2);
});

it("retains conflicting literal dotted filter fields and never falls back to them", () => {
  const configs = {a:{env_args:{seed:1},"env_args.seed":"1"}, b:{"env_args.seed":1}};
  expect(configFilterKeys(configs)).toHaveLength(2);
  const match = compileConfigFilter([[rule(["env_args", "seed"], "[1]", "IN")]], configs);
  expect(match(configs.a)).toBe(true);
  expect(match(configs.b)).toBe(false);
});

it("keeps selected equality values typed while preserving legacy text filters", () => {
  for (const [value, valueType, actual, other] of [["1","number",1,"1"],["1","string","1",1],["false","boolean",false,"false"],["null","null",null,"null"]]) {
    const groups = [[{key:'["x"]',operator:"=",value,valueType}]];
    expect(parseConfigFilters(JSON.stringify(groups))).toEqual(groups);
    const match = compileConfigFilter(groups);
    expect(match({x:actual})).toBe(true);
    expect(match({x:other})).toBe(false);
  }
  const legacy = compileConfigFilter([[{key:'["x"]',operator:"=",value:"1"}]]);
  expect(legacy({x:1})).toBe(true);
  expect(legacy({x:"1"})).toBe(true);
});
