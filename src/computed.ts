
/* IMPORT */

import {readable} from './callable';
import Observable from './observable';
import Observer from './observer';
import Owner from './owner';
import type {ComputedFunction, ObservableReadonly, ObservableOptions, PlainComputed} from './types';

/* MAIN */

//TODO: Find out why disposing automatically of the observable doesn't improve performance here

const Computed = {

  /* WRAPPING API */

  wrap: (() => { //FIXME: Ugly way to colocate the damn function overloads

    function wrap <T> ( fn: ComputedFunction<T, T | undefined> ): ObservableReadonly<T>;
    function wrap <T> ( fn: ComputedFunction<T, T | undefined>, value: undefined, options?: ObservableOptions<T, T | undefined> ): ObservableReadonly<T>;
    function wrap <T> ( fn: ComputedFunction<T, T>, value: T, options?: ObservableOptions<T, T> ): ObservableReadonly<T>;
    function wrap <T> ( fn: ComputedFunction<T, T | undefined>, value?: T, options?: ObservableOptions<T, T | undefined> ) {

      return readable ( Computed.create ( fn, value, options ).observable );

    }

    return wrap;

  })(),

  /* API */

  create: <T> ( fn: ComputedFunction<T, T | undefined>, valueInitial?: T, options?: ObservableOptions<T, T | undefined> ): PlainComputed<T, T | undefined> => {

    const computed: PlainComputed<T, T | undefined> = {
      staleCount: 0,
      staleFresh: false,
      cleanups: null,
      context: null,
      errors: null,
      observables: null,
      observers: null,
      parent: Owner.get (),
      observable: Observable.create ( valueInitial, options ),
      fn,
    };

    computed.observable.parent = computed;

    Owner.registerObserver ( computed );

    Computed.update ( computed, true );

    return computed;

  },

  update: <T> ( computed: PlainComputed, fresh: boolean ): void => {

    if ( fresh ) { // The resulting value might change

      Observer.dispose ( computed );

      const valuePrev = computed.observable.value;

      try {

        const valueNext: T = Owner.wrapWith ( computed.fn.bind ( undefined, valuePrev ), computed );

        Observable.set ( computed.observable, valueNext );

      } catch ( error: unknown ) {

        Observer.error ( computed, error );

        Observable.emitUnstale ( computed.observable, false );

      }

    } else { // The resulting value could/should not possibly change

      Observable.emitUnstale ( computed.observable, false );

    }

  }

};

/* EXPORT */

export default Computed;
