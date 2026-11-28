import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { freeformBounds, freeformSelection, setFreeformGroup, translateFreeformWidgets,
  validateFreeformWidget } from '../www/fhem-cms/js/fcui-freeform-layout.js';
import { changePageLayout, schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';

const fixture = () => ({
  schemaVersion: 6, settings: {layoutMode:'grid', gridColumns:12},
  navigation: {orientation:'horizontal',grid:{col:1,row:1,w:12,h:1}},
  pages: [
    {id:'home', title:'Home', layoutMode:'freeform', canvas:{width:1000,height:600}, widgets:[
      {id:'a', type:'text', markdown:'A', rect:{x:100,y:100,w:100,h:80,z:4}},
      {id:'b', type:'text', markdown:'B', rect:{x:300,y:200,w:120,h:100,z:2}},
      {id:'c', type:'text', markdown:'C', rect:{x:500,y:400,w:100,h:100}},
    ]},
    {id:'target', title:'Target', layoutMode:'freeform', canvas:{width:800,height:500}, widgets:[]},
    {id:'grid', title:'Grid', widgets:[]},
  ],
});
async function controllerFor(live) {
  let state = {live:structuredClone(live),draft:null,token:'a'.repeat(64)};
  let writes = 0;
  const controller = new Schema5DraftController({
    read:async () => structuredClone(state),
    save:async (draft,token) => {
      assert.equal(token,state.token);
      state = {...state,draft:structuredClone(draft),token:(++writes).toString(16).padStart(64,'0')};
    },
    publish:async () => {}, discard:async () => {},
  });
  await controller.reload();
  return {controller,writes:() => writes};
}

test('selection expands full groups and group operations preserve IDs and contents', () => {
  const page = fixture().pages[0];
  const original = structuredClone(page.widgets);
  setFreeformGroup(page,['a','b'],'g1');
  assert.deepEqual(freeformSelection(page,['b']).map(widget => widget.id),['a','b']);
  setFreeformGroup(page,['b','c'],'g2');
  assert.ok(page.widgets.every(widget => widget.groupId === 'g2'));
  setFreeformGroup(page,['a'],undefined);
  assert.deepEqual(page.widgets,original);
  assert.throws(() => setFreeformGroup(page,['a'],'g'),/Mindestens zwei/);
  assert.throws(() => freeformSelection(page,['missing']),/Unbekannt/);
  assert.throws(() => freeformSelection(page,['a','a']),/Auswahl/);
});

test('translation clamps the entire selection while preserving offsets, dimensions and layers', () => {
  const page = fixture().pages[0];
  const widgets = page.widgets.slice(0,2);
  assert.deepEqual(freeformBounds(widgets),{x:100,y:100,w:320,h:200});
  for (const [dx,dy,x,y] of [[-1000,-1000,0,0],[1000,1000,680,400],[12,34,112,134]]) {
    const changes = translateFreeformWidgets(widgets,dx,dy,page.canvas);
    assert.deepEqual(changes[0].rect,{...widgets[0].rect,x,y});
    assert.deepEqual(changes[1].rect,{...widgets[1].rect,x:x+200,y:y+100});
  }
  assert.throws(() => translateFreeformWidgets(widgets,0,0,{width:200,height:200}),/passt nicht/);
});

test('group transfer is one atomic draft save and never merges target groups', async () => {
  const live = fixture();
  setFreeformGroup(live.pages[0],['a','b'],'group');
  live.pages[1].widgets.push({id:'target-widget',type:'text',markdown:'Target',groupId:'group',
    rect:{x:0,y:0,w:20,h:20}});
  const {controller,writes} = await controllerFor(live);
  const moved = await controller.moveWidget('home','target','b',undefined,'a'.repeat(64));
  assert.equal(writes(),1);
  assert.deepEqual(moved.live,live);
  assert.deepEqual(moved.draft.pages[0].widgets.map(widget => widget.id),['c']);
  const [existing,a,b] = moved.draft.pages[1].widgets;
  assert.equal(existing.groupId,'group');
  assert.equal(a.groupId,b.groupId);
  assert.notEqual(a.groupId,existing.groupId);
  assert.deepEqual(a.rect,live.pages[0].widgets[0].rect);
  assert.deepEqual(b.rect,live.pages[0].widgets[1].rect);
  assert.equal(a.markdown,'A');
  assert.throws(() => controller.moveWidgets('home','target',['c'],'a'.repeat(64)),/veraltet/);
  assert.equal(writes(),1);
});

test('group transfer rejects incompatible targets and capacity before writing', async () => {
  for (const mode of ['grid','small','full','pins']) {
    const live = fixture();
    if (mode === 'small') live.pages[1].canvas.width = 200;
    if (mode === 'pins') live.pages[1].renderAsPins = true;
    if (mode === 'full') live.pages[1].widgets = Array.from({length:200},(_,i) => ({
      id:`w${i}`,type:'text',markdown:'',rect:{x:0,y:0,w:10,h:10},
    }));
    const {controller,writes} = await controllerFor(live);
    assert.throws(() => controller.moveWidgets('home',mode === 'grid' ? 'grid' : 'target',['a','b'],'a'.repeat(64)),
      /Freeform|passt nicht|200 Widgets|Pin/);
    assert.equal(writes(),0);
    assert.equal(controller.snapshot().draft,null);
  }
});

test('widget edits keep groups; copies, deletion and grid conversion do not leave accidental memberships', async () => {
  const live = fixture();
  setFreeformGroup(live.pages[0],['a','b'],'g');
  const {controller} = await controllerFor(live);
  let state = await controller.saveWidget('home',{...live.pages[0].widgets[0],markdown:'Edited',groupId:undefined},
    'a'.repeat(64),'update');
  assert.equal(state.draft.pages[0].widgets[0].groupId,'g');
  state = await controller.duplicateWidget('home','a',state.token);
  assert.equal(state.draft.pages[0].widgets[1].groupId,undefined);
  state = await controller.deleteWidget('home','a',state.token);
  assert.equal(state.draft.pages[0].widgets.find(widget => widget.id === 'b').groupId,undefined);
  const candidate = fixture();
  setFreeformGroup(candidate.pages[0],['a','b'],'g');
  changePageLayout(candidate,'home','grid');
  assert.ok(candidate.pages[0].widgets.every(widget => !Object.hasOwn(widget,'groupId')));
});

test('Perl and JS agree on group strings and reject grouping on grid widgets', () => {
  const values = ['g','x'.repeat(64),'', 'x'.repeat(65),'bad group','../g',1,true,null,{}];
  for (const value of values) {
    const config = fixture();
    config.pages[0].widgets[0].groupId = value;
    const valid = typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
    if (valid) validateFreeformWidget(config.pages[0].widgets[0],config.pages[0].canvas);
    else assert.throws(() => validateFreeformWidget(config.pages[0].widgets[0],config.pages[0].canvas),/Gruppe/);
    const result = spawnSync('perl',['-MJSON::PP','-e',
      'require "./FHEM/01_FHEMCMS.pm"; local $/; my $c=decode_json(<STDIN>); my $e=FHEMCMS_ValidateConfig($c,6); print defined($e) ? $e : "OK";'],
    {input:JSON.stringify(config),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    if (valid) assert.equal(result.stdout,'OK');
    else assert.match(result.stdout,/Widget-Gruppe/);
  }
  const config = fixture();
  config.pages[2].widgets.push({id:'grid-widget',type:'text',markdown:'',groupId:'g',grid:{col:1,row:2,w:2,h:2}});
  assert.throws(() => schema5GridItems(config,'grid'),/Freeform-Daten/);
});
