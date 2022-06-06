
/* IMPORT */

import {OWNER, ROOT, SYMBOL_STORE, SYMBOL_STORE_TARGET} from '~/constants';
import batch from '~/methods/batch';
import cleanup from '~/methods/cleanup';
import isStore from '~/methods/is_store';
import Computation from '~/objects/computation';
import Observable from '~/objects/observable';
import type {IObservable, ObservableOptions, StoreOptions, Signal} from '~/types';

/* TYPES */

type StoreKey = string | number | symbol;

type StoreTarget = Record<StoreKey, any>;

type StoreNode = {
  store: StoreTarget,
  signal: Signal,
  getters?: Map<StoreKey, Function>,
  setters?: Map<StoreKey, Function>,
  keys?: StoreKeys,
  has?: StoreMap<StoreKey, StoreHas>,
  properties: StoreMap<StoreKey, StoreProperty>
};

/* CLASSES */

class StoreMap<K, V> extends Map<K, V> {
  insert ( key: K, value: V ): V {
    super.set ( key, value );
    return value;
  }
}

class StoreCleanable {
  count: number = 0;
  constructor () {
    cleanup ( this );
  }
  call (): void {
    this.count -= 1;
    if ( this.count ) return;
    this.dispose ();
  }
  dispose (): void {}
}

class StoreKeys extends StoreCleanable {
  constructor ( public parent: StoreNode, public observable: IObservable<0> ) {
    super ();
  }
  dispose (): void {
    this.parent.keys = undefined;
  }
}

class StoreHas extends StoreCleanable {
  constructor ( public parent: StoreNode, public key: StoreKey, public observable: IObservable<boolean> ) {
    super ();
  }
  dispose (): void {
    this.parent.has?.delete ( this.key );
  }
}

class StoreProperty extends StoreCleanable {
  constructor ( public parent: StoreNode, public key: StoreKey, public observable: IObservable<unknown>, public node?: StoreNode ) {
    super ();
  }
  dispose (): void {
    this.parent.properties.delete ( this.key );
  }
}

/* CONSTANTS */

const NODES = new WeakMap<StoreTarget, StoreNode> ();

const TRAPS = {

  /* API */

  get: ( target: StoreTarget, key: StoreKey ): unknown => {

    if ( key === SYMBOL_STORE ) return true;

    if ( key === SYMBOL_STORE_TARGET ) return target;

    if ( key === '__proto__' || key === 'prototype' || key === 'constructor' ) return target[key];

    if ( key === 'hasOwnProperty' || key === 'isPrototypeOf' || key === 'propertyIsEnumerable' || key === 'toLocaleString' || key === 'toSource' || key === 'toString' || key === 'valueOf' ) return target[key];

    const node = getNodeExisting ( target );
    const getter = node.getters?.get ( key );

    if ( getter ) {

      return getter.call ( node.store );

    } else {

      const value = target[key];
      const property = node.properties.get ( key ) || node.properties.insert ( key, getNodeProperty ( node, key, value ) );

      if ( typeof value === 'function' && value === Array.prototype[key as any] ) { //TSC
        return function () {
          return batch ( () => value.apply ( node.store, arguments ) );
        };
      }

      property.count += 1;
      property.observable.read ();

      return property.node?.store || value;

    }

  },

  set: ( target: StoreTarget, key: StoreKey, value: unknown ): boolean => {

    value = getTarget ( value );

    const node = getNodeExisting ( target );
    const setter = node.setters?.get ( key );

    if ( setter ) {

      batch ( () => setter.call ( node.store, value ) );

    } else {

      const hadProperty = ( key in target );

      target[key] = value;

      batch ( () => {

        if ( !hadProperty ) {
          node.keys?.observable.write ( 0 );
          node.has?.get ( key )?.observable.write ( true );
        }

        const property = node.properties.get ( key );
        if ( property ) {
          property.observable.write ( value );
          property.node = isProxiable ( value ) ? NODES.get ( value ) || getNode ( value, node ) : undefined;
        }

      });

    }

    return true;

  },

  deleteProperty: ( target: StoreTarget, key: StoreKey ): boolean => {

    const hasProperty = ( key in target );

    if ( !hasProperty ) return true;

    const deleted = Reflect.deleteProperty ( target, key );

    if ( !deleted ) return false;

    const node = getNodeExisting ( target );

    batch ( () => {

      node.keys?.observable.write ( 0 );
      node.has?.get ( key )?.observable.write ( false );

      const property = node.properties.get ( key );
      if ( property ) {
        property.observable.write ( undefined );
        property.node = undefined;
      }

    });

    return true;

  },

  has: ( target: StoreTarget, key: StoreKey ): boolean => {

    if ( key === SYMBOL_STORE ) return true;

    if ( key === SYMBOL_STORE_TARGET ) return true;

    const value = ( key in target );

    if ( isListenable () ) {

      const node = getNodeExisting ( target );

      node.has ||= new StoreMap ();

      const has = node.has.get ( key ) || node.has.insert ( key, getNodeHas ( node, key, value ) );

      has.count += 1;
      has.observable.read ();

    }

    return value;

  },

  ownKeys: ( target: StoreTarget ): (string | symbol)[] => {

    const keys = Reflect.ownKeys ( target );

    if ( isListenable () ) {

      const node = getNodeExisting ( target );

      node.keys ||= getNodeKyes ( node );
      node.keys.count += 1;
      node.keys.observable.read ();

    }

    return keys;

  },

  defineProperty: ( target: StoreTarget, key: StoreKey, descriptor: PropertyDescriptor ): boolean => {

    throw new Error ( 'Stores do not support using Object.defineProperty' );

  }

};

/* HELPERS */

const getNode = <T = StoreTarget> ( value: T, parent?: StoreNode ): StoreNode => {

  const store = new Proxy ( value, TRAPS );
  const signal = parent?.signal || OWNER.current.signal || ROOT.current;
  const {getters, setters} = getGettersAndSetters ( value );
  const properties = new StoreMap<StoreKey, StoreProperty> ();
  const node: StoreNode = { store, signal, properties };

  if ( getters ) node.getters = getters;
  if ( setters ) node.setters = setters;

  NODES.set ( value, node );

  return node;

};

const getNodeExisting = <T = StoreTarget> ( value: T ): StoreNode => {

  const node = NODES.get ( value );

  if ( !node ) throw new Error ();

  return node;

};

const getNodeKyes = ( node: StoreNode ): StoreKeys => {

  const observable = getNodeObservable<0> ( node, 0, { equals: false } );
  const keys = new StoreKeys ( node, observable );

  return keys;

};

const getNodeHas = ( node: StoreNode, key: StoreKey, value: boolean ): StoreHas => {

  const observable = getNodeObservable ( node, value );
  const has = new StoreHas ( node, key, observable );

  return has;

};

const getNodeObservable = <T> ( node: StoreNode, value: T, options?: ObservableOptions ): IObservable<T> => {

  const observable = new Observable ( value, options );

  observable.signal = node.signal;

  return observable;

};

const getNodeProperty = ( node: StoreNode, key: StoreKey, value: unknown ): StoreProperty => {

  const observable = getNodeObservable ( node, value );
  const propertyNode = isProxiable ( value ) ? NODES.get ( value ) || getNode ( value, node ) : undefined;
  const property = new StoreProperty ( node, key, observable, propertyNode );

  node.properties.set ( key, property );

  return property;

};

const getGettersAndSetters = ( value: StoreTarget ): { getters?: Map<string | symbol, Function>, setters?: Map<string | symbol, Function> } => {

  let getters: Map<string | symbol, Function> | undefined;
  let setters: Map<string | symbol, Function> | undefined;

  const keys = Reflect.ownKeys ( value );

  for ( let i = 0, l = keys.length; i < l; i++ ) {

    const key = keys[i];
    const descriptor = Object.getOwnPropertyDescriptor ( value, key );

    if ( !descriptor ) continue;

    const {get, set} = descriptor;

    if ( get ) {
      getters ||= new Map ();
      getters.set ( key, get );
    }

    if ( set ) {
      setters ||= new Map ();
      setters.set ( key, set );
    }

  }

  return { getters, setters };

};

const getStore = <T = StoreTarget> ( value: T ): T => {

  if ( isStore ( value ) ) return value;

  const node = NODES.get ( value ) || getNode ( value );

  return node.store;

};

const getTarget = <T> ( value: T ): T => {

  if ( isStore ( value ) ) return ( value as any )[SYMBOL_STORE_TARGET]; //TSC

  return value;

};

const isListenable = (): boolean => { // Checks whether the current owner can listen for observables

  return ( OWNER.current instanceof Computation );

};

const isProxiable = ( value: unknown ): value is StoreTarget => { // Checks whether the value can be proxied

  if ( value === null || typeof value !== 'object' ) return false;

  if ( Array.isArray ( value ) ) return true;

  const prototype = Object.getPrototypeOf ( value );

  if ( prototype === null ) return true;

  return ( Object.getPrototypeOf ( prototype ) === null );

};

/* MAIN */

//TODO: Add an option for glitch-free batching, making it clear that that would break type-checking
//TODO: Add an option for immutable stores that are edited via set/merge/produce functions, which have none of the issues but poor DX
//TODO: Support listening to everything
//TODO: Support Object.defineProperty
//TODO: Support proxying more built-ins: ArrayBuffer, RegExp, Date, TypedArray, Map, WekaMap, Set, WeakSet

const store = <T> ( value: T, options?: StoreOptions ): T => {

  if ( !isProxiable ( value ) ) return value;

  if ( options?.unwrap ) return getTarget ( value );

  return getStore ( value );

};

/* EXPORT */

export default store;
