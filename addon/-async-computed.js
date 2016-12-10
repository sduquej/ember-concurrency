import Ember from 'ember';
import TaskInstance from './-task-instance';
import { yieldableSymbol } from './utils';

const { computed, defineProperty, get } = Ember;

const AsyncProperty = Ember.Object.extend({
  context: null,
  //_last: computed(function () {
    //return TaskInstance.create({
    //})._start();
  //}),
  value: computed.alias('_last.value'),
});

export const asyncComputed = (...deps) => {
  return computed(function() {
    let fn = deps.pop();
    let context = this;
    let ap = AsyncProperty.create({
      context,
    });

    let scopedDeps = deps.map(d => `context.${d}`);
    let cpDeps = scopedDeps.slice();
    cpDeps.push(function() {
      return TaskInstance.create({
        fn,
        args: scopedDeps.map((k) => {
          let val = get(this, k);
          return val instanceof AsyncProperty ? get(val, 'value') : val;
        }),
        context,
      })._start();
    });

    defineProperty(ap, '_last', computed(...cpDeps));

    return ap;
  });
};

