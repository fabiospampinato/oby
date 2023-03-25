
/* IMPORT */

import {OWNER} from '~/context';
import cleanup from '~/methods/cleanup';
import CacheAbstract from '~/methods/for_abstract.cache';
import resolve from '~/methods/resolve';
import {frozen, readable} from '~/objects/callable';
import Observable from '~/objects/observable';
import Root from '~/objects/root';
import {SYMBOL_CACHED, SYMBOL_UNCACHED} from '~/symbols';
import type {IObservable, IOwner, MapFunction, Resolved} from '~/types';

/* HELPERS */

const DUMMY_INDEX = frozen ( -1 );

class MappedRoot<T = unknown> extends Root { // This saves some memory compared to making a dedicated standalone object for metadata
  bool?: boolean;
  index?: IObservable<number>;
  result?: T;
}

/* MAIN */

class Cache<T, R> extends CacheAbstract<T, R> {

  /* VARIABLES */

  private fn: MapFunction<T, R>;
  private fnWithIndex: boolean;
  private cache: Map<T, MappedRoot<Resolved<R>>> = new Map ();
  private bool = false; // The bool is flipped with each iteration, the roots that don't have the updated one are disposed, it's like a cheap counter basically
  private prevCount: number = 0; // Number of previous items
  private reuseCount: number = 0; // Number of previous items that got reused
  private nextCount: number = 0; // Number of next items
  private parent: IOwner = OWNER;

  /* CONSTRUCTOR */

  constructor ( fn: MapFunction<T, R> ) {

    super ( fn );

    this.fn = fn;
    this.fnWithIndex = ( fn.length > 1 );
    // this.parent.registerRoot ( this.roots );

  }

  /* API */

  cleanup = (): void => {

    if ( !this.prevCount ) return; // There was nothing before, no need to cleanup

    if ( this.prevCount === this.reuseCount ) return; // All the previous items were reused, no need to cleanup

    const {cache, bool} = this;

    if ( !cache.size ) return; // Nothing to dispose of

    if ( this.nextCount ) { // Regular cleanup

      cache.forEach ( ( mapped, value ) => {

        if ( mapped.bool === bool ) return;

        mapped.dispose ();

        cache.delete ( value );

      });

    } else { // There is nothing after, disposing quickly

      this.cache.forEach ( mapped => {

        mapped.dispose ();

      });

      this.cache = new Map ();

    }

  };

  dispose = (): void => {

    // this.parent.unregisterRoot ( this.roots );

    this.prevCount = this.cache.size;
    this.reuseCount = 0;
    this.nextCount = 0;

    this.cleanup ();

  };

  before = ( values: readonly T[] ): void => {

    this.bool = !this.bool;
    this.reuseCount = 0;
    this.nextCount = 0;

  };

  after = ( values: readonly T[] ): void => {

    this.nextCount = values.length;

    this.cleanup ();

    this.prevCount = this.nextCount;
    this.reuseCount = 0;

  };

  map = ( values: readonly T[] ): Resolved<R>[] => {

    this.before ( values );

    const {cache, bool, fn, fnWithIndex} = this;
    const results: Resolved<R>[] = new Array ( values.length );

    let resultsCached = true; // Whether all results are cached, if so this enables an optimization
    let resultsUncached = true; // Whether all results are anew, if so this enables an optimization in Voby
    let reuseCount = 0;

    for ( let i = 0, l = values.length; i < l; i++ ) {

      const value = values[i];
      const cached = cache.get ( value );

      if ( cached && cached.bool !== bool ) {

        resultsUncached = false;
        reuseCount += 1;

        cached.bool = bool;
        cached.index?.write ( i );

        results[i] = cached.result!; //TSC

      } else {

        resultsCached = false;

        const mapped = new MappedRoot<R> ();

        if ( cached ) {

          cleanup ( () => mapped.dispose () );

        }

        mapped.wrap ( () => {

          let index = DUMMY_INDEX;

          if ( fnWithIndex ) {

            mapped.index = new Observable ( i );
            index = readable ( mapped.index );

          }

          const result = results[i] = resolve ( fn ( value, index ) );

          mapped.bool = bool;
          mapped.result = result;

          if ( !cached ) {

            cache.set ( value, mapped );

          }

        });

      }

    }

    this.reuseCount = reuseCount;

    this.after ( values );

    if ( resultsCached ) {

      results[SYMBOL_CACHED] = true;

    }

    if ( resultsUncached ) {

      results[SYMBOL_UNCACHED] = true;

    }

    return results;

  };

  roots = (): MappedRoot<R>[] => {

    return Array.from ( this.cache.values () );

  };

};

/* EXPORT */

export default Cache;
