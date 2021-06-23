
let wasm;

let cachegetUint8Memory0 = null;
function getUint8Memory0() {
    if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
        cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachegetUint8Memory0;
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1);
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachegetUint32Memory0 = null;
function getUint32Memory0() {
    if (cachegetUint32Memory0 === null || cachegetUint32Memory0.buffer !== wasm.memory.buffer) {
        cachegetUint32Memory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachegetUint32Memory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4);
    getUint32Memory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachegetFloat64Memory0 = null;
function getFloat64Memory0() {
    if (cachegetFloat64Memory0 === null || cachegetFloat64Memory0.buffer !== wasm.memory.buffer) {
        cachegetFloat64Memory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachegetFloat64Memory0;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8);
    getFloat64Memory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachegetInt32Memory0 = null;
function getInt32Memory0() {
    if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
        cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachegetInt32Memory0;
}

function getArrayF64FromWasm0(ptr, len) {
    return getFloat64Memory0().subarray(ptr / 8, ptr / 8 + len);
}
/**
* @param {Uint8Array} hits
* @param {Uint8Array} misses
* @param {number} squids_gotten
* @returns {Float64Array | undefined}
*/
export function calculate_probabilities_without_sequence(hits, misses, squids_gotten) {
    var ptr0 = passArray8ToWasm0(hits, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(misses, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.calculate_probabilities_without_sequence(8, ptr0, len0, ptr1, len1, squids_gotten);
    var r0 = getInt32Memory0()[8 / 4 + 0];
    var r1 = getInt32Memory0()[8 / 4 + 1];
    let v2;
    if (r0 !== 0) {
        v2 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 8);
    }
    return v2;
}

/**
* @param {Uint8Array} hits
* @param {Uint8Array} misses
* @param {number} squids_gotten
* @param {Uint32Array} observed_boards
* @param {Uint32Array} prior_steps_from_previous_means
* @param {Float64Array} prior_steps_from_previous_stddevs
* @returns {Float64Array | undefined}
*/
export function calculate_probabilities_from_game_history(hits, misses, squids_gotten, observed_boards, prior_steps_from_previous_means, prior_steps_from_previous_stddevs) {
    var ptr0 = passArray8ToWasm0(hits, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(misses, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = passArray32ToWasm0(observed_boards, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    var ptr3 = passArray32ToWasm0(prior_steps_from_previous_means, wasm.__wbindgen_malloc);
    var len3 = WASM_VECTOR_LEN;
    var ptr4 = passArrayF64ToWasm0(prior_steps_from_previous_stddevs, wasm.__wbindgen_malloc);
    var len4 = WASM_VECTOR_LEN;
    wasm.calculate_probabilities_from_game_history(8, ptr0, len0, ptr1, len1, squids_gotten, ptr2, len2, ptr3, len3, ptr4, len4);
    var r0 = getInt32Memory0()[8 / 4 + 0];
    var r1 = getInt32Memory0()[8 / 4 + 1];
    let v5;
    if (r0 !== 0) {
        v5 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 8);
    }
    return v5;
}

/**
* @param {Uint8Array} hits
* @param {Uint8Array} misses
* @param {number} squids_gotten
* @param {Uint32Array} observed_boards
* @param {Uint32Array} prior_steps_from_previous_means
* @param {Float64Array} prior_steps_from_previous_stddevs
* @returns {number | undefined}
*/
export function disambiguate_board(hits, misses, squids_gotten, observed_boards, prior_steps_from_previous_means, prior_steps_from_previous_stddevs) {
    var ptr0 = passArray8ToWasm0(hits, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(misses, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = passArray32ToWasm0(observed_boards, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    var ptr3 = passArray32ToWasm0(prior_steps_from_previous_means, wasm.__wbindgen_malloc);
    var len3 = WASM_VECTOR_LEN;
    var ptr4 = passArrayF64ToWasm0(prior_steps_from_previous_stddevs, wasm.__wbindgen_malloc);
    var len4 = WASM_VECTOR_LEN;
    wasm.disambiguate_board(8, ptr0, len0, ptr1, len1, squids_gotten, ptr2, len2, ptr3, len3, ptr4, len4);
    var r0 = getInt32Memory0()[8 / 4 + 0];
    var r1 = getInt32Memory0()[8 / 4 + 1];
    return r0 === 0 ? undefined : r1 >>> 0;
}

/**
* @param {Uint32Array} board_table
*/
export function set_board_table(board_table) {
    var ptr0 = passArray32ToWasm0(board_table, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.set_board_table(ptr0, len0);
}

async function load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {

        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

async function init(input) {
    //if (typeof input === 'undefined') {
    //    input = import.meta.url.replace(/\.js$/, '_bg.wasm');
    //}
    const imports = {};


    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }

    const { instance, module } = await load(await input, imports);

    wasm = instance.exports;
    init.__wbindgen_wasm_module = module;

    return wasm;
}

export default init;

