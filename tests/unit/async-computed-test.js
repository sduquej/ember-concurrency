import Ember from 'ember';
//import TaskInstance from 'ember-concurrency/-task-instance';
import { asyncComputed, timeout } from 'ember-concurrency';
import { module, test } from 'qunit';

const defer = Ember.RSVP.defer;

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

test("async properties get passed sync resolved yieldables", function(assert) {
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

test("async properties get passed async resolved yieldables", function(assert) {
  assert.expect(2);
  let done = assert.async();

  let klass = Ember.Object.extend({
    a: null,
    b: asyncComputed('a', function * () {
      return 123;
    }),
  });

  let obj;
  Ember.run(() => {
    obj = klass.create({ a: timeout(1) });
    assert.equal(obj.get('b.value'), null);
  });

  Ember.run.later(() => {
    assert.equal(obj.get('b.value'), 123);
    done();
  }, 20);
});

test("async properties depending on async properties", function(assert) {
  assert.expect(2);

  let aDefer, bDefer;
  let klass = Ember.Object.extend({
    a: asyncComputed(function * () {
      aDefer = defer();
      return aDefer.promise;
    }),
    b: asyncComputed(function * () {
      bDefer = defer();
      return bDefer.promise;
    }),
    c: asyncComputed('a', 'b', function * (a, b) {
      return [a, b];
    }),
  });

  let obj;
  Ember.run(() => {
    obj = klass.create();
    assert.equal(obj.get('c.value'), null);
  });
  // TODO: test that these are both set to begin with, pending
  // task-aware implementation of `all()`.
  Ember.run(aDefer, 'resolve', 'A');
  Ember.run(bDefer, 'resolve', 'B');
  assert.deepEqual(obj.get('c.value'), ['A', 'B']);
});


