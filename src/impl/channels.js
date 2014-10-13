"use strict";

var buffers = require("./buffers");
var dispatch = require("./dispatch");

var Reduced = require("transducers.js").Reduced;
var MAX_DIRTY = 64;
var MAX_QUEUE_SIZE = 1024;

var CLOSED = null;

var Box = function(value) {
  this.value = value;
};

var PutBox = function(handler, value) {
  this.handler = handler;
  this.value = value;
};

var Channel = function(takes, puts, buf, add) {
  this.buf = buf;
  this.add = add;
  this.takes = takes;
  this.puts = puts;

  this.dirty_takes = 0;
  this.dirty_puts = 0;
  this.closed = false;
};

Channel.prototype._put = function(value, handler) {
  if (value === CLOSED) {
    throw new Error("Cannot put CLOSED on a channel.");
  }

  if (this.closed || !handler.is_active()) {
    return new Box(!this.closed);
  }

  var taker, callback;

  // Soak the value through the buffer first, even if there is a
  // pending taker. This way the step function has a chance to act on the
  // value.
  if (this.buf && !this.buf.is_full()) {
    handler.commit();
    var done = (this.add(this.buf, value) instanceof Reduced);
    while (true) {
      if (this.buf.count() === 0) {
        break;
      }
      taker = this.takes.pop();
      if (taker === buffers.EMPTY) {
        break;
      }
      if (taker.is_active()) {
        callback = taker.commit();
        value = this.buf.remove();
        dispatch.run(function() {
          callback(value);
        });
        break;
      }
    }
    if (done) {
      this.close();
    }
    return new Box(true);
  }

  // Either the buffer is full, in which case there won't be any
  // pending takes, or we don't have a buffer, in which case this loop
  // fulfills the first of them that is active (note that we don't
  // have to worry about transducers here since we require a buffer
  // for that.
  while (true) {
    taker = this.takes.pop();
    if (taker === buffers.EMPTY) {
      break;
    }
    if (taker.is_active()) {
      handler.commit();
      callback = taker.commit();
      dispatch.run(function() {
        callback(value);
      });
      return new Box(true);
    }
  }

  // No buffer, full buffer, no pending takes. Queue this put now.
  if (this.dirty_puts > MAX_DIRTY) {
    this.puts.cleanup(function(putter) {
      return putter.handler.is_active();
    });
    this.dirty_puts = 0;
  } else {
    this.dirty_puts ++;
  }
  if (this.puts.length >= MAX_QUEUE_SIZE) {
    throw new Error("No more than " + MAX_QUEUE_SIZE + " pending puts are allowed on a single channel.");
  }
  this.puts.unbounded_unshift(new PutBox(handler, value));
  return null;
};

Channel.prototype._take = function(handler) {
  if (!handler.is_active()) {
    return null;
  }

  var putter, put_handler, callback, value;

  if (this.buf && this.buf.count() > 0) {
    handler.commit();
    value = this.buf.remove();
    // We need to check pending puts here, other wise they won't
    // be able to proceed until their number reaches MAX_DIRTY
    while (true) {
      if (this.buf.is_full()) {
        break;
      }
      putter = this.puts.pop();
      if (putter === buffers.EMPTY) {
        break;
      }
      put_handler = putter.handler;
      if (put_handler.is_active()) {
        callback = put_handler.commit();
        dispatch.run(function() {
          callback(true);
        });
        if (this.add(this.buf, putter.value) instanceof Reduced) {
          this.close();
        }
        break;
      }
    }
    return new Box(value);
  }

  while (true) {
    putter = this.puts.pop();
    if (putter === buffers.EMPTY) {
      break;
    }
    put_handler = putter.handler;
    if (put_handler.is_active()) {
      callback = put_handler.commit();
      dispatch.run(function() {
        callback(true);
      });
      return new Box(putter.value);
    }
  }

  // XXX: This section looks weird
  if (this.closed) {
    if (this.buf) {
      // TODO: Doesn't this mean there can be more than 1 completion?
      this.add(this.buf);
    }
    if (handler.is_active()) {
      handler.commit();
      if (this.buf && this.buf.count() > 0) {
        value = this.buf.remove();
        return new Box(value);
      }
      return new Box(CLOSED);
    }
  }

  // No buffer, empty buffer, no pending puts. Queue this take now.
  if (this.dirty_takes > MAX_DIRTY) {
    this.takes.cleanup(function(handler) {
      return handler.is_active();
    });
    this.dirty_takes = 0;
  } else {
    this.dirty_takes ++;
  }
  if (this.takes.length >= MAX_QUEUE_SIZE) {
    throw new Error("No more than " + MAX_QUEUE_SIZE + " pending takes are allowed on a single channel.");
  }
  this.takes.unbounded_unshift(handler);
  return null;
};

Channel.prototype.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  while (true) {
    var taker = this.takes.pop();
    if (taker === buffers.EMPTY) {
      break;
    }
    if (taker.is_active()) {
      var callback = taker.commit();
      dispatch.run(function() {
        callback(CLOSED);
      });
    }
  }
  // TODO: Tests
  while (true) {
    var putter = this.puts.pop();
    if (putter === buffers.EMPTY) {
      break;
    }
    if (putter.handler.is_active()) {
      var put_callback = putter.handler.commit();
      dispatch.run(function() {
        put_callback(false);
      });
    }
  }
  // TODO: Why here?
  if (this.buf) {
    this.add(this.buf);
  }
};


Channel.prototype.is_closed = function() {
  return this.closed;
};

function defaultHandler(e) {
  console.log('error in channel transformer', e.stack);
}

function handleEx(buf, exHandler, e) {
  var def = (exHandler || defaultHandler)(e);
  if (def !== undefined && def !== CLOSED) {
    buf.add(def);
  }
  return buf;
}

// The base transformer object to use with transducers
function AddTransformer() {
}

AddTransformer.prototype.init = function() {
  throw new Error('init not available');
};

AddTransformer.prototype.result = function(v) {
  return v;
};

AddTransformer.prototype.step = function(buffer, input) {
  buffer.add(input);
  return buffer;
};

exports.chan = function(buf, xform, exHandler) {
  if(xform) {
    xform = xform(new AddTransformer());
  }

  return new Channel(buffers.ring(32),
                     buffers.ring(32),
                     buf,
                     function(buf, x) {
                       var l = arguments.length;
                       if (xform) {
                         try {
                           if (l === 2) {
                             return xform.step(buf, x);
                           } else if (l === 1) {
                             return xform.result(buf);
                           } else {
                             throw new Error('init not available');
                           }
                         } catch (e) {
                           return handleEx(buf, exHandler, e);
                         }
                       } else {
                         if (l === 2) {
                           buf.add(x);
                           return buf;
                         } else if (l === 1) {
                           return buf;
                         } else {
                           throw new Error('init not available');
                         }
                       }
                     });
};

exports.Box = Box;

exports.CLOSED = CLOSED;
