import Ember from 'ember';
//import TaskInstance from 'ember-concurrency/-task-instance';
import { asyncComputed, timeout } from 'ember-concurrency';
import { module, test } from 'qunit';

module('Unit: async computed');

test(".value synchronously produces a value if possible", function(assert) {
  assert.expect(2);

  let klass = Ember.Object.extend({
    a: asyncComputed(function * () {
      return 123;
    }),
    b: asyncComputed(function * () {
      return 456;
    }),
  });

  Ember.run(() => {
    assert.equal(klass.create().get('a.value'), 123);
    assert.equal(klass.create().get('b.value'), 456);
  });
});

test("async properties get passed synchronously resolved values of their async prop deps", function(assert) {
  assert.expect(2);

  let klass = Ember.Object.extend({
    a: asyncComputed(function * () {
      return 999;
    }),
    b: asyncComputed('a', function * (a) {
      assert.equal(a, 999);
      return a;
    }),
  });

  Ember.run(() => {
    assert.equal(klass.create().get('b.value'), 999);
  });
});

test("async properties get passed synchronously resolved yieldables", function(assert) {
  assert.expect(2);

  let klass = Ember.Object.extend({
    a: null,
    b: asyncComputed('a', function * (a) {
      assert.equal(a, 999);
      return a;
    }),
  });

  Ember.run(() => {
    assert.equal(klass.create({
      a: Ember.RSVP.resolve(999)
    }).get('b.value'), 999);
  });
});

