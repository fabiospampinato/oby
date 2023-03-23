
/* IMPORT */

import {OWNER, SUSPENSE, setSuspense, setSuspenseEnabled} from '~/context';
import {lazyArrayEach, lazySetEach} from '~/lazy';
import suspended from '~/methods/suspended';
import Effect from '~/objects/effect';
import Observer from '~/objects/observer';
import {SYMBOL_SUSPENSE} from '~/symbols';
import {isFunction} from '~/utils';
import type {IObserver, IRoot, SuspenseFunction} from '~/types';

/* MAIN */

class Suspense extends Observer {

  /* VARIABLES */

  parent: IObserver = OWNER;
  suspended: number = suspended () || 0; // 0: UNSUSPENDED, 1: THIS_SUSPENDED, 2+: THIS_AND_PARENT_SUSPENDED

  /* CONSTRUCTOR */

  constructor () {

    super ();

    setSuspenseEnabled ( true );

    OWNER.registerObserver ( this );

    this.write ( SYMBOL_SUSPENSE, this );

  }

  /* API */

  toggle ( force: boolean ): void {

    if ( !this.suspended && !force ) return; // Already suspended, this can happen at instantion time

    const suspendedPrev = this.suspended;

    this.suspended += force ? 1 : -1;

    if ( suspendedPrev >= 2 ) return; // No pausing or resuming

    /* NOTIFYING EFFECTS AND SUSPENSES */

    const notifyRoot = ( root: IRoot | (() => IRoot[]) ): void => {
      if ( isFunction ( root ) ) {
        root ().forEach ( notifyObserver );
      } else {
        notifyObserver ( root );
      }
    };

    const notifyObserver = ( observer: IObserver ): void => {
      if ( observer instanceof Suspense ) return;
      if ( observer instanceof Effect ) {
        observer.emit ( force ? 1 : -1, false );
      }
      lazyArrayEach ( observer.observers, notifyObserver );
      lazySetEach ( observer.roots, notifyRoot );
    };

    const notifySuspense = ( observer: IObserver ): void => {
      if ( !( observer instanceof Suspense ) ) return;
      observer.toggle ( force );
    };

    lazyArrayEach ( this.observers, notifyObserver );
    lazyArrayEach ( this.observers, notifySuspense );
    lazySetEach ( this.roots, notifyRoot );

  }

  wrap <T> ( fn: SuspenseFunction<T> ): T {

    const suspensePrev = SUSPENSE;

    setSuspense ( this );

    try {

      return super.wrap ( fn );

    } finally {

      setSuspense ( suspensePrev );

    }

  }

}

/* EXPORT */

export default Suspense;
