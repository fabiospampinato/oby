
/* IMPORT */

import {BATCH, OWNER, ROOT, ROOT_DISPOSED, TRACKING} from '~/context';
import {lazySetAdd, lazySetDelete, lazySetHas} from '~/lazy';
import {getExecution, getCount} from '~/status';
import {is, nope} from '~/utils';
import type {IComputation, IMemo, IObservable, IObserver, EqualsFunction, ListenerFunction, UpdateFunction, ObservableOptions, Callable, LazySet, Signal} from '~/types';

/* MAIN */

class Observable<T = unknown> {

  /* VARIABLES */

  parent?: IMemo<T>;
  signal: Signal = ROOT;
  value: T;
  equals?: EqualsFunction<T>;
  listeners?: LazySet<Callable<ListenerFunction<T>>>;
  observers?: LazySet<IObserver>;

  /* CONSTRUCTOR */

  constructor ( value: T, options?: ObservableOptions<T>, parent?: IMemo<T> ) {

    this.value = value;

    if ( parent ) {

      this.parent = parent;

    }

    if ( options?.equals !== undefined ) {

      this.equals = options.equals || nope;

    }

  }

  /* REGISTRATION API */

  registerListener ( listener: Callable<ListenerFunction<T>> ): void {

    if ( lazySetHas ( this.listeners, listener ) ) return;

    lazySetAdd ( this, 'listeners', listener );

  }

  registerObserver ( observer: IObserver ): void {

    lazySetAdd ( this, 'observers', observer );

  }

  registerSelf (): void {

    if ( this.signal.disposed ) return;

    if ( TRACKING ) {

      const owner = OWNER;

      if ( owner.observables !== this ) {

        this.registerObserver ( owner );

        owner.registerObservable ( this as IObservable<any> ); //TSC

      }

    }

    if ( this.parent && getCount ( this.parent.status ) ) { // Potentially stale value, forcing a refresh

      this.parent.status = getExecution ( this.parent.status );

      this.parent.update ( true );

    }

  }

  unregisterListener ( listener: Callable<ListenerFunction<T>> ): void {

    lazySetDelete ( this, 'listeners', listener );

  }

  unregisterObserver ( observer: IObserver ): void {

    lazySetDelete ( this, 'observers', observer );

  }

  /* API */

  read (): T {

    this.registerSelf ();

    return this.value;

  }

  write ( value: T ): T {

    if ( this.signal === ROOT_DISPOSED ) throw new Error ( 'A disposed Observable can not be updated' );

    if ( BATCH ) {

      BATCH.set ( this, value );

      return value;

    } else {

      const equals = this.equals || is;
      const fresh = !equals ( value, this.value );

      if ( !this.parent ) {

        if ( !fresh ) return value;

        if ( !this.signal.disposed ) {

          this.emit ( 1, fresh );

        }

      }

      if ( fresh ) {

        const valuePrev = this.value;

        this.value = value;

        this.listened ( valuePrev );

      }

      if ( !this.signal.disposed ) {

        this.emit ( -1, fresh );

      }

      return value;

    }

  }

  update ( fn: UpdateFunction<T> ): T {

    const valueNext = fn ( this.value );

    return this.write ( valueNext );

  }

  emit ( change: -1 | 1, fresh: boolean ): void {

    if ( this.signal.disposed ) return;

    const computations = this.observers as LazySet<IComputation>; //TSC

    if ( computations ) {

      if ( computations instanceof Set ) {

        for ( const computation of computations ) {

          computation.emit ( change, fresh );

        }

      } else {

        computations.emit ( change, fresh );

      }

    }

  }

  listened ( valuePrev?: T ): void {

    if ( this.signal.disposed ) return;

    const {listeners} = this;

    if ( listeners ) {

      if ( listeners instanceof Set ) {

        for ( const listener of listeners ) {

          listener.call ( listener, this.value, valuePrev );

        }

      } else {

        listeners.call ( listeners, this.value, valuePrev );

      }

    }

  }

  dispose (): void {

    this.signal = ROOT_DISPOSED;

  }

}

/* EXPORT */

export default Observable;
