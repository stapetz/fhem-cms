import test from 'node:test';
import assert from 'node:assert/strict';
import {createValueProbe} from '../www/fhem-cms/js/value-probe.js';

test('value probe uses click toggles and held touch with explicit gesture cleanup', () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const target = new EventTarget();
  let visible = false, shows = 0;
  const probe = createValueProbe(target, {
    show:() => { visible = true; shows++; },
    hide:() => { visible = false; },
  });
  const send = (type, overrides = {}) => {
    const event = new Event(type);
    Object.assign(event, {pointerId:1,pointerType:'mouse',button:0,clientX:10,clientY:20},overrides);
    target.dispatchEvent(event);
  };
  try {
    send('pointermove');
    assert.equal(shows,0,'hover alone remains inactive');
    send('pointerdown'); send('pointerup'); send('pointermove');
    assert.equal(visible,true);
    assert.equal(shows,2,'first click activates tracking');
    send('pointerleave');
    assert.equal(visible,false);
    send('pointermove');
    assert.equal(visible,true,'leaving hides values without changing click mode');
    send('pointerdown'); send('pointerup'); send('pointermove');
    assert.equal(visible,false,'second click disables tracking');
    send('pointerdown',{pointerType:'touch'});
    assert.equal(visible,true);
    send('pointermove',{pointerType:'touch',clientX:12});
    assert.equal(visible,true);
    send('pointerup',{pointerType:'touch'});
    assert.equal(visible,false,'release clears touch values');
    send('pointerdown'); send('pointermove',{clientX:30}); send('pointerup',{clientX:30});
    assert.equal(visible,false,'drag is not treated as a toggle');
    send('pointerdown',{pointerType:'touch'});
    send('pointercancel',{pointerType:'touch'});
    assert.equal(visible,false);
    send('pointerdown',{pointerType:'touch'});
    probe.clear();
    send('pointerup',{pointerType:'touch'});
    assert.equal(visible,false,'pan takeover cannot reactivate values');
    send('pointerdown'); send('pointerup');
    window.dispatchEvent(new Event('blur'));
    send('pointermove');
    assert.equal(visible,false,'blur clears active mode');
    probe.dispose();
    const before = shows;
    send('pointerdown'); send('pointerup');
    assert.equal(shows,before,'dispose releases all listeners');
  } finally {
    probe.dispose();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
