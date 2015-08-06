/// <reference path="./node_modules/havelock/dist/havelock.d.ts"/>
/// <reference path="./node_modules/immutable/dist/immutable.d.ts"/>

/***

# Caching Derivations

#### Probelms

You've got a derivable list of values, and you want to map some function over
them to create a new derivable list of values. Here's the obvious way to do it:

***/
import {atom, Atom, Derivable} from 'havelock';
import * as _ from 'havelock';
import {List, Map} from 'immutable';
import * as $ from 'immutable';

const numbers: Atom<List<number>> = atom(List([1,2,3]));
const doubled: Derivable<List<number>> = numbers.derive(xs => {
  return xs.map(x => x * 2).toList();
});

/***

The problem with this is that each time `numbers` changes, every item in it is reprocessed. This isn't so bad when all you're doing is doubling an integer, but it would be nice to have a way to avoid doing the mapping for values that don't change. This could be very beneficial if the cost of the mapping dwarfs the overhead involved in figuring out which items have changed etc.

Another related problem situation is if you have a list whose contents might change in any way, but you want to react to changes in list items individually. There's no obvious way to do that with havelock straight out of the box.

Let's call the first problem 'the mapping problem' and the second 'the reacting problem' for brevity's sake.

#### Solving the Mapping Problem

The solution starts out by taking the derivable list of values and converting it into a derivable list of derivable values.

That might look like this (forgive the weird declaration, we'll need to rebind it later):

***/

let explode: <T>(xs: Derivable<List<T>>) => Derivable<List<Derivable<T>>>
= xs => {
  const size = xs.derive(xs => xs.size);
  return size.derive(size => {
    return $.Range(0, size).map(i => xs.derive(xs => xs.get(i))).toList();
  });
}

/***

*Also, please don't freak out about the nested derivableness. It's fine. Honest.*

So for every index in `xs`, we create a new derivable which simply looks up that index. Now we can partially solve the mapping problem

***/

let map: <I,O>(f: (x:I) => O, xs: Derivable<List<I>>) => Derivable<List<O>>
= <I,O>(f: (x:I) => O, xs: Derivable<List<I>>) => {
  // first get the list of derivables
  let dxsI: Derivable<List<Derivable<I>>> = explode(xs);
  // now map f over the derivables
  let dxsO: Derivable<List<Derivable<O>>> = dxsI.derive(dxs => {
    return dxs.map(dx => dx.derive(f)).toList();
  });
  // so at this point the Derivable<O>s only get recalculated when the
  // Derivable<I>s change. And, if you'll remember, the Derivable<I>s
  // get recalculated whenever xs changes, but they might not have changed.

  // and finally unpack
  return dxsO.derive(dxs => dxs.map(_.unpack).toList());
  // so the result List<O> gets rebuilt whenever any one of the Derivable<O>s
  // changes. This is as good as it gets with immutable collections.
}

const logAndDouble = x => {console.log(x); return x*2;};

let cachedDoubled: Derivable<List<number>> = map(logAndDouble, numbers);

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> cd: List [ 2, 4, 6 ]

numbers.set(List([1, 10, 3]));

console.log("cd:", cachedDoubled.get());
// $> 10
// $> cd: List [ 2, 20, 6 ]

/***

The reason this is only a partial solution is that if `xs` changes in length, all the derivations get regenerated which means all the values get recomputed.

***/


console.log("cd:", cachedDoubled.get());

numbers.set(List([1, 2, 3, 4]));

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> 4
// $> cd: List [ 2, 4, 6, 8 ]

/***

So how to avoid this? Caching! If `explode` caches the `Derivable<T>`s, it can use
them again when the size of xs changes. Here's basic caching in action:

***/

explode = <T>(xs: Derivable<List<T>>): Derivable<List<Derivable<T>>> => {
  const size = xs.derive(xs => xs.size);

  let cache: List<Derivable<T>> = List<Derivable<T>>();

  return size.derive(size => {
    if (size > cache.size) {
      // xs got bigger, add more items to the cache
      cache = cache.concat($.Range(cache.size, size).map(i => {
        return xs.derive(xs => xs.get(i));
      })).toList();
    } else {
      // xs is either the same size or smaller, so truncate
      cache = cache.setSize(size);
    }
    return cache;
  });
}

numbers.set(List([1,2,3]));

// re-bind cachedDoubled so it uses the new `explode`
cachedDoubled = map(logAndDouble, numbers);

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> cd: List [ 2, 4, 6 ]

numbers.set(List([1,2,3,4]));

console.log("cd:", cachedDoubled.get());
// 1
// 2
// 3
// 4
// cd: List [ 2, 4, 6, 8 ]

/***

Wait, that's not right. We don't want the 1, 2, and 3 to be logged again.

Alas, the `map` function rebuilds it's `Derivable<List<Derivable<O>>>` each time its `Derivable<List<Derivable<I>>>` changes. To fix this, `f` needs to be propagated into `explode`.

***/

let mapsplode: <I, O>(f: (v:I) => O, xs: Derivable<List<I>>) => Derivable<List<Derivable<O>>>
= <I, O>(f, xs) => {
  const size = xs.derive(xs => xs.size);

  let cache: List<Derivable<O>> = List<Derivable<O>>();

  return size.derive(size => {
    if (size > cache.size) {
      // xs got bigger, add more items to the cache
      cache = cache.concat($.Range(cache.size, size).map(i => {
        return xs.derive(xs => xs.get(i)).derive(f);
      })).toList();
    } else {
      // xs is either the same size or smaller, so truncate
      cache = cache.setSize(size);
    }
    return cache;
  });
}

map = <I, O>(f: (v:I) => O, xs: Derivable<List<I>>) => {
  // just unpack mapsplode output
  return mapsplode(f, xs).derive(dxs => dxs.map(_.unpack).toList());
};

numbers.set(List([1,2,3]));

// re-bind cachedDoubled so it uses the new `map`
cachedDoubled = map(logAndDouble, numbers);

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> cd: List [ 2, 4, 6 ]

numbers.set(List([1,2,3,4]));

console.log("cd:", cachedDoubled.get());
// 4
// cd: List [ 2, 4, 6, 8 ]

/***

Progress!

Unfortunately, we're not quite there yet. Look what happens if you add a number at the beginning rather than at the end:

***/

numbers.set(List([0,1,2,3,4]));

console.log("cd:", cachedDoubled.get());
// $> 0
// $> 1
// $> 2
// $> 3
// $> 4
// $> cd: List [ 0, 2, 4, 6, 8 ]

/***

This is because the derivations created in `mapsplode` are merely indexing into `xs`. We need some way to associate them with particular values in the list. We could do that if we have some model of what makes the values in the list unique. So in addition to the derivations we could cache a map from those unique ids to their indices in `xs`. Then the derivations would first look up their index in the map before using it to look up their value in `xs`. Here's how that looks:

***/


let mapsplodeU: <I, O, U>(uf: (v:I) => U, f: (v:I) => O, xs: Derivable<List<I>>) => Derivable<List<Derivable<O>>>
= <I, O, U>(uf, f, xs) => {
  let cache: Map<U, Derivable<O>> = Map<U, Derivable<O>>();

  const ids: Derivable<List<U>> = xs.derive(xs => xs.map(uf).toList());
  const id2idx: Derivable<Map<U, number>> = ids.derive(ids => {
    let map = Map<U, number>().asMutable();
    ids.forEach((id, idx) => {
      map.set(id, idx);
    });
    return map.asImmutable();
  });

  return ids.derive(ids => {
    let newCache = Map<U, Derivable<O>>().asMutable();
    let result = [];

    ids.forEach(id => {
      if (newCache.has(id)) {
        throw new Error(`duplicate id ${id}`);
      }
      let derivation: Derivable<O> = cache.get(id);
      if (derivation == null) {
        derivation = xs.derive(xs => xs.get(id2idx.get().get(id))).derive(f);
      }
      newCache.set(id, derivation);
      result.push(derivation);
    });

    cache = newCache.asImmutable();
    return List(result);
  });
};

/***

So, to recap, `uf` is our uniqueness function which returns ids for the items in `xs`. We then map those ids to their corresponding indices, and then build a derivation cache based on those ids, which derivations look up their index in `id2idx` which they then use to lookup their value in `xs`. *Phew*. Well done if you're still reading this!

And because we are using immutable data, it is totally possible to just use the identiy function as `uf` most of the time.

***/

mapsplode = <I, O>(f, xs) => mapsplodeU(x => x, f, xs);

/***

Let's see if that clears things up for us.

***/

numbers.set(List([1,2,3]));

// re-bind cachedDoubled so it uses the new `mapsplode`
cachedDoubled = map(logAndDouble, numbers);

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> cd: List [ 2, 4, 6 ]

numbers.set(List([0,1,2,3]));
console.log("cd:", cachedDoubled.get());
// $> 0
// $> cd: List [ 0, 2, 4, 6 ]

/***

That's the ticket.

***/

numbers.set(List([3,2,1,0]));
console.log("cd:", cachedDoubled.get());
// $> cd: List [ 6, 4, 2, 0 ]

/***

Aww yiss.

So that's *almost* the whole story. The one last wrinkle is how to deal with duplicate IDs. At the moment we just throw an error. But, because we're using immutable data, duplicates are fine as long as the uniqueness function is correct.

A uniqueness function `uf` is correct if there exist no two values `a` and `b` such that `a != b && uf(a) == uf(b)`.

One derivation is the same as another if they derive the same value in the same way at the same time. So, e.g, if we have a derivable list of values `D(['a', 'b', 'b'])` and we map them with an uppercasing function to get `D(['A', 'B', 'B'])`, it doesn't matter if the two `'B'` both derived from the `'b'` at index 1 or index 2 in the original list. As long as changes to the original `'b'`s are propagated correctly, it makes not one bit of difference.

So lets change mapslodeU to allow duplicates:

***/

// we're gonna use the ids + id2idx pattern a few more times so for brevity...
interface IDStuff<U> {
  ids: Derivable<List<U>>
  id2idx: Derivable<Map<U, number>>
}

function deriveIDStuff<T, U> (uf: (v:T) => U, xs: Derivable<List<T>>): IDStuff<U> {
  const ids: Derivable<List<U>> = xs.derive(xs => xs.map(uf).toList());
  const id2idx: Derivable<Map<U, number>> = ids.derive(ids => {
    let map = Map<U, number>().asMutable();
    ids.forEach((id, idx) => {
      map.set(id, idx);
    });
    return map.asImmutable();
  });
  return {ids, id2idx};
}

mapsplodeU = <I, O, U>(uf, f, xs) => {
  let cache: Map<U, Derivable<O>> = Map<U, Derivable<O>>();

  const {ids, id2idx} = deriveIDStuff<I, U>(uf, xs);

  return ids.derive(ids => {
    let newCache = Map<U, Derivable<O>>().asMutable();
    let result = [];

    ids.forEach(id => {
      // allow duplicates
      let derivation: Derivable<O> = newCache.get(id);
      if (derivation == null) {
        derivation = cache.get(id);
        if (derivation == null) {
          derivation = xs.derive(xs => xs.get(id2idx.get().get(id))).derive(f);
        }
        newCache.set(id, derivation);
      }
      result.push(derivation);
    });

    cache = newCache.asImmutable();
    return List(result);
  });
};

numbers.set(List([1,2,3]));

// re-bind cachedDoubled so it uses the new `mapsplodeU`
cachedDoubled = map(logAndDouble, numbers);

console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> 3
// $> cd: List [ 2, 4, 6 ]

numbers.set(List([1,2,2]));
console.log("cd:", cachedDoubled.get());
// $> cd: List [ 2, 4, 4 ]

numbers.set(List([2,2,2,2,2,2,2]));
console.log("cd:", cachedDoubled.get());
// $> cd: List [ 4, 4, 4, 4, 4, 4, 4 ]

/***

That's the mapping problem solved then. You can supply your own `uf` for efficiency
purposes, but beware that an incorrect `uf` will cause some whack behaviour.

***/

cachedDoubled = mapsplodeU(x => x % 2, logAndDouble, numbers)
                  .derive(dxs => dxs.map(_.unpack).toList());

numbers.set(List([1,2]));
console.log("cd:", cachedDoubled.get());
// $> 1
// $> 2
// $> cd: List [ 2, 4 ]

numbers.set(List([1,2,3]));
console.log("cd:", cachedDoubled.get());
// $> 3
// $> cd: List [ 6, 4, 6 ]

numbers.set(List([1,2,3,4,5,6,7,8,9,10]));
console.log("cd:", cachedDoubled.get());
// ...
// $> cd: List [ 18, 20, 18, 20, 18, 20, 18, 20, 18, 20 ]

/***

So don't use custom uniquness functions unless you're certain they are correct!

#### Solving the Reacting Problem

This one is slightly more tricky because Reactions have lifecycles, so we need to
start them and stop them when we create and dispose of them:

***/

import { Reaction } from 'havelock'

let resplodeU: <T, U>(uf: (v: T) => U, r: (v: T) => void, xs: Derivable<List<T>>) => Reaction<void>
= <T, U>(uf, r, xs) => {

  // just like before except cache stores reactions rather than derivations
  let cache: Map<U, Reaction<T>> = Map<U, Reaction<T>>();

  const {ids, id2idx} = deriveIDStuff<T, U>(uf, xs);

  // and now instead of deriving a list from `ids`, we simply react to it
  ids.react(ids => {
    let newCache = Map<U, Reaction<T>>().asMutable();

    ids.forEach(id => {
      // disallow duplicates
      if (newCache.has(id)) {
        throw new Error(`duplicate id '${id}'`);
      }
      let reaction: Reaction<T> = cache.get(id);

      if (reaction == null) {
        // implicitly start new reactions
        reaction = xs.derive(xs => xs.get(id2idx.get().get(id))).react(r);
      } else {
        // remove from last cache so we don't stop it later
        cache = cache.remove(id);
      }
      newCache.set(id, reaction);
    });

    cache.valueSeq().forEach(r => r.stop());

    cache = newCache.asImmutable();
  });

  return null;
}

/***

Alright that seems fine.

***/

// class WithIndex<T> {
//   value: T;
//   index: number;
//   constructor (value, index) {
//     this.value = value;
//     this.index = index;
//   }
// }
//
// class Resplosion<T, U> extends Reaction<List<U>> {
//   cache: Map<U, Reaction<T>>;
//   xs: Derivable<List<T>>
//   constructor (uf: (v:T) => U, f: (v:T) => Reaction<T>, xs: Derivable<List<T>>) {
//     super();
//     let ids: Derivable<List<U>> = xs.derive(xs => xs.map(uf).toList());
//
//     this.xs = xs;
//     this.cache = Map<U, Reaction<T>>();
//
//     const id2idx: Derivable<Map<U, number>> = ids.derive(ids => {
//       let map = Map<U, number>().asMutable();
//       ids.forEach((id, idx) => {
//         map.set(id, idx);
//       });
//       return map.asImmutable();
//     });
//   }
//   onStop () {
//     // stop all reactions in cache and clear
//     this.cache.valueSeq().forEach(r => {
//       r.stop();
//     });
//     this.cache = Map<U, Reaction<T>>();
//   }
//   react (ids: List<U>) {
//     let newCache = Map<U, Reaction<T>>().asMutable();
//     let result = [];
//
//     ids.forEach(id => {
//       if (newCache.get(id)) {
//         throw new Error(`duplicate id ${id}`);
//       }
//       let reaction: Reaction<T> = this.cache.get(id);
//       if (reaction == null) {
//         derivation = xs.derive(xs => xs.get(id2idx.get().get(id))).derive(f);
//         newCache.set(id, derivation);
//       }
//       result.push(derivation);
//     });
//
//     cache = newCache.asImmutable();
//     return List(result);
//   }
// }
