import assert from 'node:assert/strict';
import {test} from 'node:test';
import {centerNewPin, pinCanvasPoint, pinImageFrame, validatePinPosition, translateFloorplanSelection} from '../www/fhem-cms/js/pin-layout.js';
import {schema5GridItems, changePageLayout} from '../www/fhem-cms/js/fcui-schema5-layout.js';
import {Schema5DraftController} from '../www/fhem-cms/js/fcui-schema5-draft.js';
import {Schema5WidgetSession} from '../www/fhem-cms/js/fcui-schema5-widget-session.js';

test('Floorplan selection translates pins and cards against one shared image boundary', () => {
  const canvas = {width:1000,height:600}, frame = pinImageFrame(canvas,{width:600,height:600});
  const widgets = [
    {id:'a',rect:{x:0,y:0,w:100,h:100},position:{centerX:20,centerY:30}},
    {id:'b',rect:{x:0,y:0,w:100,h:100},position:{centerX:70,centerY:60}},
    {id:'card',rect:{x:100,y:400,w:100,h:100}},
  ];
  const isPin = id => id !== 'card', position = widget => widget.position;
  const original = structuredClone(widgets);
  const moved = translateFloorplanSelection(widgets,60,30,canvas,frame,isPin,position);
  assert.deepEqual(moved.map(widget => widget.position),[{centerX:30,centerY:35},{centerX:80,centerY:65},undefined]);
  assert.deepEqual(moved[2].rect,{x:160,y:430,w:100,h:100});
  const edge = translateFloorplanSelection(widgets,5000,5000,canvas,frame,isPin,position);
  assert.equal(edge[1].position.centerX,100);
  assert.equal(edge[0].position.centerX,50);
  assert.equal(edge[2].rect.y,500,'card bottom constrains entire selection');
  assert.deepEqual(widgets,original,'pure translation never changes source widgets');
  assert.throws(() => translateFloorplanSelection([],0,0,canvas,frame,isPin,position),/Floorplan/);
  assert.throws(() => translateFloorplanSelection(widgets,NaN,0,canvas,frame,isPin,position),/Floorplan/);
});

test('Pin positions are exact bounded percentages, optional and Freeform-only', () => {
  for (const position of [{centerX:0,centerY:100},{centerX:42.53,centerY:61.83}]) {
    assert.doesNotThrow(() => validatePinPosition(position));
  }
  for (const position of [null, [], {}, {centerX:'50',centerY:50}, {centerX:50,centerY:NaN},
    {centerX:-.01,centerY:50}, {centerX:100.01,centerY:50}, {centerX:1.234,centerY:50},
    {centerX:50,centerY:50,extra:true}]) assert.throws(() => validatePinPosition(position));
  const config = {schemaVersion:6,settings:{layoutMode:'grid',gridColumns:12},
    navigation:{grid:{col:1,row:1,w:12,h:1}},pages:[{
      id:'home',title:'Home',layoutMode:'freeform',canvas:{width:1280,height:800},renderAsPins:true,
      widgets:[{id:'pin',type:'fhem-value',device:'Demo',reading:'state',rect:{x:0,y:0,w:200,h:200},
        position:{centerX:0,centerY:100}}],
    }]};
  const bytes = JSON.stringify(config);
  schema5GridItems(config,'home');
  assert.equal(JSON.stringify(config),bytes,'validation never migrates stored positions');
  const image = pinImageFrame(config.pages[0].canvas,{width:800,height:800});
  assert.deepEqual(pinCanvasPoint(config.pages[0].widgets[0].position,image),{x:240,y:800});
  changePageLayout(config,'home','grid');
  assert.equal(Object.hasOwn(config.pages[0].widgets[0],'position'),false,'Grid conversion removes Pin-only placement');
  config.pages[0].widgets[0].position={centerX:0,centerY:100};
  assert.throws(() => schema5GridItems(config,'home'),/Freeform/);
});

test('new Pin widgets are centred without changing card size', () => {
  const widget={rect:{x:10,y:20,w:200,h:180}};
  centerNewPin(widget,{width:1280,height:800});
  assert.deepEqual(widget.position,{centerX:50,centerY:50});
  assert.deepEqual(widget.rect,{x:540,y:310,w:200,h:180});
});

test('Pin placement survives widget editing, duplication and draft publish; Grid moves clear it', async () => {
  const live = {schemaVersion:6,settings:{layoutMode:'grid',gridColumns:12},
    navigation:{grid:{col:1,row:1,w:12,h:1}},pages:[
      {id:'home',title:'Home',layoutMode:'freeform',renderAsPins:true,
        canvas:{width:1280,height:800},widgets:[]},
      {id:'grid',title:'Grid',widgets:[]},
    ]};
  let state={live:structuredClone(live),draft:null,token:'a'.repeat(64)};
  let revision=0;
  const token=() => (++revision).toString(16).padStart(64,'0');
  const controller = new Schema5DraftController({
    read:async () => structuredClone(state),
    save:async (draft,expected) => {
      assert.equal(expected,state.token);
      state={...state,draft:structuredClone(draft),token:token()};
    },
    publish:async expected => {
      assert.equal(expected,state.token);
      state={live:state.draft,draft:null,token:token()};
    },
    discard:async () => {},
  });
  await controller.reload();
  await controller.saveWidget('home',{id:'new',type:'fhem-value',device:'Demo',reading:'state',
    rect:{x:0,y:0,w:200,h:120}},state.token,'create');
  let widget=state.draft.pages[0].widgets[0];
  assert.deepEqual(widget.position,{centerX:50,centerY:50});
  assert.deepEqual(widget.rect,{x:540,y:340,w:200,h:120});
  const candidate=structuredClone(state.draft);
  candidate.pages[0].widgets[0].position={centerX:0,centerY:100};
  candidate.pages[0].widgets[0].rect={x:0,y:680,w:200,h:120};
  await controller.saveDraft(candidate,state.token);
  widget=state.draft.pages[0].widgets[0];
  const session=new Schema5WidgetSession({controller,pageId:'home',token:state.token,widget,action:'update'});
  const {position,rect,...oldDialog}=widget;
  await session.services({}).saveWidget({...oldDialog,title:'Changed'});
  assert.deepEqual(state.draft.pages[0].widgets[0].position,position,'older widget dialogs retain percentage placement');
  assert.deepEqual(state.draft.pages[0].widgets[0].rect,rect);
  await controller.duplicateWidget('home','new',state.token);
  assert.deepEqual(state.draft.pages[0].widgets[1].position,{centerX:2,centerY:100});
  assert.deepEqual(state.live,live,'Pin edits never change live before publish');
  await controller.publishDraft(state.token);
  assert.deepEqual(state.live.pages[0].widgets[0].position,position);
  await controller.moveWidget('home','grid','new',{col:1,row:2,w:4,h:3},state.token);
  const moved=state.draft.pages[1].widgets[0];
  assert.equal(Object.hasOwn(moved,'position'),false);
  assert.equal(Object.hasOwn(moved,'rect'),false);
});
