import imut from 'immutable';
import _, {atom, derive, transact} from '../dist/havelock';
import assert from 'assert';

describe("the humble atom", () => {
  const n = atom(0);

  it("can be dereferenced via .get to obtain its current state", () => {
    assert.strictEqual(n.get(), 0);
  });

  it("can be .set to change its current state", () => {
    n.set(1);
    assert.strictEqual(n.get(), 1);
  });

  it("can be .swap-ped a la clojure", () => {
    const double = x => x * 2;
    n.swap(double);
    assert.strictEqual(n.get(), 2);
    _.swap(n, double);
    assert.strictEqual(n.get(), 4);
    n.swap(double);
    assert.strictEqual(n.get(), 8);
  });

  it(`can take on temporary values inside a transaction`, () => {
    const a = atom("a");
    transact(abort => {
      a.set("b");
      assert.strictEqual(a.get(), "b");
      transact(abort => {
        a.set("c");
        assert.strictEqual(a.get(), "c");
        abort();
      });
      assert.strictEqual(a.get(), "b");
      abort();
    });
    assert.strictEqual(a.get(), "a");
  });

  it(`can keep transaction values if they are't aborted`, () => {
    const a = atom("a");
    transact(() => {
      a.set("b");
      transact(() => {
        a.set("c");
      });
      assert.strictEqual(a.get(), "c");
    });
    assert.strictEqual(a.get(), "c");
  });

  it(`can include a validation function`, () => {
    const a = atom("x").withValidator(thing => thing.length < 5);
    assert.throws(() => {
      a.set("abcde");
    });
    a.set("blah");
    a.validate();
    assert.strictEqual(a.get(), "blah");

    const b = a.withValidator(thing => thing instanceof Array);
    assert.throws(() => {
      b.validate();
    });
    assert.throws(() => {
      b.set("a");
    });
    b.set(['b', 'l', 'a', 'h']);
    assert.throws(() => {
      b.set([0,1,2,3,4]);
    });

  });
});
