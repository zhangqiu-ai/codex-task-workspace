import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, normalizeLanguage, translate, localizeError } from '../ui/i18n.js';

test('Chinese and English dictionaries have complete matching keys',()=>{
  assert.deepEqual(Object.keys(dictionaries.zh).sort(),Object.keys(dictionaries.en).sort());
  for(const locale of ['zh','en'])for(const [key,value] of Object.entries(dictionaries[locale])){
    assert.equal(typeof value,'string',`${locale}.${key}`);
    assert.ok(value.trim(),`${locale}.${key} must not be empty`);
  }
});
test('locale detection accepts region variants and falls back to English',()=>{
  assert.equal(normalizeLanguage('zh-CN'),'zh');
  assert.equal(normalizeLanguage('zh-TW'),'zh');
  assert.equal(normalizeLanguage('en-US'),'en');
  assert.equal(normalizeLanguage('fr-FR'),'en');
});
test('unrecognized diagnostics remain available without rewriting user content',()=>{
  const diagnostic='SQLite: custom diagnostic / 原始信息';
  assert.equal(localizeError('en',diagnostic),diagnostic);
  assert.equal(localizeError('zh',diagnostic),diagnostic);
});
test('translated templates preserve inserted user text verbatim',()=>{
  const title='My Work / 当前任务 {title}';
  assert.equal(translate('en','currentTask',{title}),`Active task: ${title}`);
  assert.equal(translate('zh','currentTask',{title}),`当前任务：${title}`);
  assert.equal(localizeError('zh','Task not found'),'未找到任务');
});
