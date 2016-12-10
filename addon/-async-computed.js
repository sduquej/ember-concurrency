import Ember from 'ember';
import TaskInstance from './-task-instance';
import { yieldableSymbol } from './utils';

const { computed, defineProperty, get } = Ember;

const AsyncProperty = Ember.Object.extend({
  context: null,
  _last: null,
  value: computed.alias('_last.value'),

  [yieldableSymbol](taskInstance, resumeIndex) {
    return get(this, '_last')[yieldableSymbol](taskInstance, resumeIndex);
  },
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
      //if (lastTaskInstance) lastTaskInstance.cancel()
      return TaskInstance.create({
        fn: function * () {
          let resolvedArgs = [];
          try {
            // resolvedArgs = yield all(scopedDeps.map(k => get(this, k)));
            // note: RSVP.all doesn't eagerly/synchronously handle
            // child promises that are RSVP/sync compliant.
            for (let i = 0; i < scopedDeps.length; ++i) {
              let scopedValue = yield get(ap, scopedDeps[i]);
              resolvedArgs.push(scopedValue);
            }
          } catch(e) {
            console.error("resolve error. TODO handle me.");
            console.error(e);
            return;
          }

          return TaskInstance.create({
            context,
            fn,
            args: resolvedArgs,
          })._start();
        },
        args: [],
        context,
      })._start();
    });

    defineProperty(ap, '_last', computed(...cpDeps));

    return ap;
  });
};

