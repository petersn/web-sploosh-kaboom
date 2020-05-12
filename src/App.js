import React from 'react';
import './App.css';
import init, {
    set_board_table,
    calculate_probabilities_with_board_constraints,
    calculate_probabilities_from_game_history,
    disambiguate_final_board,
} from './wasm/sploosh_wasm.js';
const interpolate = require('color-interpolate');

var globalDB = null;
const indexedDBreq = window.indexedDB.open('splooshkaboom', 1);
indexedDBreq.onerror = function(event) {
    alert('Failed to access IndexedDB.');
};
// Known issue: There's basically a race condition here in that I don't
// wait for this onsuccess to potentially start calling dbRead.
indexedDBreq.onsuccess = function(event) {
    globalDB = event.target.result;
    globalDB.onerror = function(event) {
        alert('IndexedDB error: ' + event.target.errorCode);
    };
};
indexedDBreq.onupgradeneeded = function(event) {
    const db = event.target.result;
    db.createObjectStore('sk');
}

// TODO: Am I using IndexedDB even remotely correctly!? This looks so weird...
// Do I not have to somehow end or commit the transactions!?

function dbWrite(key, value) {
    if (globalDB === null)
        return;

    const transaction = globalDB.transaction(['sk'], 'readwrite');

    transaction.oncomplete = function(event) {
        //alert('Transaction complete!');
    }
    transaction.onerror = function(event) {
        alert('Transaction error!');
    }
    const objectStore = transaction.objectStore('sk');
    const request = objectStore.add(value, key);
    request.onsuccess = function(event) {
        //alert('Request success!');
    }
}

function dbRead(key) {
    return new Promise((resolve, reject) => {
        const transaction = globalDB.transaction(['sk']);

        transaction.oncomplete = function(event) {
            //alert('Transaction complete!');
        }
        transaction.onerror = function(event) {
            alert('Transaction error!');
        }
        const objectStore = transaction.objectStore('sk');
        const request = objectStore.get(key);
        request.onsuccess = function(event) {
            //alert('Request success!');
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            //alert('Request failure!');
            reject();
        };
    });
}

//const colormap = interpolate(['#004', '#090', '#0a0', 'green']);
//const colormap = interpolate(['#004', '#0a0', '#0d0', '#0f0', '#6f6']);
// .        . . . .
// 0123456789abcdef
const colormap = interpolate(['#004', '#070', '#090', '#0b0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] === this.props.x && this.props.best[1] === this.props.y;

        let backgroundColor = this.props.backgroundColor;
        if (backgroundColor === undefined) {
            backgroundColor = this.props.text === null ? colormap(this.props.prob) : (
                this.props.text === 'HIT' ? '#a2a' : '#44a'
            );
        }

        return <div
            key={this.props.x + ',' + this.props.y}
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                width: '70px',
                height: '70px',
                border: this.props.valid ? '1px solid grey' : '1px solid red',
                outline: isBest ? '4px solid yellow' : '',
                zIndex: isBest ? 1 : 0,
                fontFamily: 'monospace',
                userSelect: 'none',
                MozUserSelect: 'none',
                WebkitUserSelect: 'none',
                msUserSelect: 'none',
                color: 'white',
                fontSize: this.props.fontSize,
                opacity: this.props.opacity,
                backgroundColor,
            }}
            onClick={this.props.onClick}
        >
            {this.props.text === null ? (this.props.prob * 100).toFixed(this.props.precision) + '%' : this.props.text}
        </div>;
    }
}

let wasm = init(process.env.PUBLIC_URL + "/sploosh_wasm_bg.wasm");

// Debugging value, ignore me.
window.JUST_ONCE = false;

// Super ugly, please forgive me. :(
var globalMap = null;

async function tryToProcessFrame() {
    if (globalMap === null)
        return;
    if (globalMap.readyToProcess() && globalMap.state.doVideoProcessing)
        await globalMap.readBoardState();
}

async function globalProcessingTick() {
    await tryToProcessFrame();
    // We use setTimeout nested like this rather than setInterval so that the ticks
    // don't get bunched up if the processing takes too long.
    setTimeout(globalProcessingTick, 25);
}

async function dbCachedFetch(url, callback) {
    function cacheMiss() {
        const req = new XMLHttpRequest();
        req.open('GET', process.env.PUBLIC_URL + url, true);
        req.responseType = 'arraybuffer';
        req.onload = (evt) => {
            dbWrite(url, req.response);
            callback(req.response);
        };
        req.send();
        return null;
    }
    const result = await dbRead(url).catch(cacheMiss);
    if (result === undefined) {
        cacheMiss();
        return;
    }
    // This is sort of an ugly protocol, but if we hit the catch path above
    // we signal that the callback was already called by returning null.
    if (result === null)
        return;
    callback(result);
}

async function makeBoardIndicesTable() {
    function cacheMiss() {
        const result = actuallyMakeBoardIndicesTable();
        dbWrite('boardIndicesTable', result);
        return result;
    }
    const result = await dbRead('boardIndicesTable').catch(cacheMiss);
    if (result === undefined)
        return cacheMiss();
    return result;
}

function actuallyMakeBoardIndicesTable() {
    // This convention here has to match that in the Rust component and table building C++ exactly!
    const descs = [];
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
            for (const direction of [false, true])
                descs.push({x, y, direction});
    const allBoards = [];
    const boardIndices = {};
    function placeSquid(board, desc, length) {
        for (let i = 0; i < length; i++) {
            let {x, y} = desc;
            if (desc.direction)
                x += i;
            else
                y += i;
            const index = x + 8 * y;
            if (x >= 8 || y >= 8)
                return;
            board[index] = length;
        }
    }
    const board = new Array(64).fill(0);

    for (const squid2 of descs) {
        for (const squid3 of descs) {
            for (const squid4 of descs) {
                board.fill(0);
                placeSquid(board, squid2, 2);
                placeSquid(board, squid3, 3);
                placeSquid(board, squid4, 4);
                let count = 0;
                for (const entry of board)
                    count += entry
                if (count !== 2*2 + 3*3 + 4*4)
                    continue;
                allBoards.push(Array.from(board));
            }
        }
    }
    let index = 0;
    for (const board of allBoards) {
        boardIndices[board.map((i) => i === 0 ? '.' : i).join('')] = index;
        index++;
    }
    return boardIndices;
}

if (!window.JUST_ONCE) {
    // XXX: Only re-enable this if we're re-enabling CV screen cap.
    //globalProcessingTick();
}

function sampleSquid(length) {
    const x = Math.round(Math.random() * 8);
    const y = Math.round(Math.random() * 8);
    const direction = Math.random() < 0.5;
    const cells = [[x, y]];
    for (let i = 0; i < length - 1; i++) {
        const cell = cells[cells.length - 1];
        const newXY = direction ? [cell[0] + 1, cell[1]] : [cell[0], cell[1] + 1];
        cells.push(newXY);
    }
    return cells;
}

function generateLayout() {
    const layout = {};
    const hitLocations = {};
    for (const n of [2, 3, 4]) {
        while (true) {
            const candidate = sampleSquid(n);
            let isAdmissible = true;
            for (const cell of candidate)
                if (cell[0] > 7 || cell[1] > 7 || hitLocations[cell] === true)
                    isAdmissible = false;
            if (isAdmissible) {
                layout['squid' + n] = candidate;
                for (const cell of candidate)
                    hitLocations[cell] = true;
                break;
            }
        }
    }
    return layout;
}

class LayoutDrawingBoard extends React.Component {
    constructor() {
        super();
        this.state = { grid: this.makeEmptyGrid(), selectedCell: null };
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = '.';
        return grid;
    }

    clearBoard() {
        this.setState({ grid: this.makeEmptyGrid(), selectedCell: null });
    }

    onClick(x, y) {
        if (this.state.selectedCell === null) {
            this.setState({ selectedCell: [x, y] });
            return;
        }
        const grid = {...this.state.grid};
        let changeMade = false;
        for (const length of [2, 3, 4]) {
            for (const [dx, dy] of [[+1, 0], [0, +1], [-1, 0], [0, -1]]) {
                if (this.state.selectedCell[0] === x + dx * (length - 1) && this.state.selectedCell[1] === y + dy * (length - 1)) {
                    // If this squid appears anywhere else, obliterate it.
                    for (let y = 0; y < 8; y++)
                        for (let x = 0; x < 8; x++)
                            if (grid[[x, y]] === '' + length)
                                grid[[x, y]] = '.';
                    // Fill in the squid here.
                    for (let i = 0; i < length; i++)
                        grid[[x + i * dx, y + i * dy]] = '' + length;
                    changeMade = true;
                }
            }
        }
        // If any squid has the wrong count, then totally eliminate it.
        const countsBySquid = {2: 0, 3: 0, 4: 0, '.': 0};
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                countsBySquid[grid[[x, y]]]++;
        for (const length of [2, 3, 4])
            if (countsBySquid[length] !== length)
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 8; x++)
                        if (grid[[x, y]] === '' + length)
                            grid[[x, y]] = '.';
        if (changeMade)
            this.setState({ grid });
        this.setState({ selectedCell: null });
    }

    getLayoutString() {
        // Quadratic time, but who cares?
        let layoutString = '';
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                layoutString += this.state.grid[[x, y]];
        return layoutString;
    }

    setStateFromLayoutString(layoutString) {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = layoutString[x + 8 * y];
        this.setState({grid});
    }

    render() {
        const layoutString = this.getLayoutString();
        let boardIndex = this.props.parent.boardIndices[layoutString];
        if (boardIndex === undefined) {
            boardIndex = "waiting...";
        }
        const isSelectedCell = (x, y) => this.state.selectedCell !== null && x === this.state.selectedCell[0] && y === this.state.selectedCell[1];

        return <div style={{
            margin: '20px',
            display: 'inline-block',
            color: 'white',
        }}>
            <div style={{
                backgroundImage: 'url("' + process.env.PUBLIC_URL + '/board_background_square.png")',
                backgroundSize: '100% 100%',
                padding: '18px',
            }}>
                {naturalsUpTo(8).map(
                    (y) => <div key={y} style={{
                        display: 'flex',
                    }}>
                        {naturalsUpTo(8).map(
                            (x) => <Tile
                                key={x + ',' + y}
                                x={x} y={y}
                                onClick={() => this.onClick(x, y)}
                                text={this.state.grid[[x, y]]}
                                valid={true}
                                best={this.state.selectedCell}
                                fontSize={'200%'}
                                opacity={isSelectedCell(x, y) || this.state.grid[[x, y]] !== '.' ? 0.6 : 0.2}
                                backgroundColor={this.state.grid[[x, y]] === '.' ? undefined : 'green'}
                            />
                        )}
                    </div>
                )}
            </div><br/>
            Squid Layout: {boardIndex}
        </div>;
    }
}

var globalBoardTimer = null;

setInterval(
    () => {
        if (globalBoardTimer !== null)
            globalBoardTimer.forceUpdate();
    },
    69,
);

function renderYesNo(bool) {
    return bool ?
        <span style={{color: 'green', textShadow: '0px 0px 2px white'}}>YES</span> :
        <span style={{color: 'red', textShadow: '0px 0px 2px white'}}>NO</span>;
}

class BoardTimer extends React.Component {
    constructor() {
        super();
        globalBoardTimer = this;
        this.state = {
            previouslyAccumulatedSeconds: 0.0,
            //previouslyAccumulatedRupeeSeconds: 0.0,
            timerStartMS: 0.0,
            timerRunning: false,
            includesLoadingTheRoom: true,
            //rupeesCollected: false,
            includedRewardsGotten: 0,
            invalidated: false,
        };
    }

    toggleRunning() {
        const now = performance.now();
        const elapsed = 1e-3 * (now - this.state.timerStartMS);
        if (this.state.timerRunning)
            this.setState({previouslyAccumulatedSeconds: this.state.previouslyAccumulatedSeconds + elapsed});
        this.setState({timerRunning: !this.state.timerRunning, timerStartMS: now});
    }

    adjustRewards(delta) {
        this.setState({includedRewardsGotten: Math.max(0, Math.min(2, this.state.includedRewardsGotten + delta))});
    }

    toggleLoadingTheRoom() {
        this.setState({includesLoadingTheRoom: !this.state.includesLoadingTheRoom});
    }

    toggleInvalidated() {
        this.setState({invalidated: !this.state.invalidated});
    }

    /*
    toggleRupeesCollected() {
        // TODO: Appropriately perform accumulation, then change the rate.
        this.setState({rupeesCollected: !this.state.rupeesCollected});
    }
    */

    resetTimer() {
        this.setState({
            previouslyAccumulatedSeconds: 0.0,
            timerStartMS: performance.now(),
            timerRunning: false,
        });
    }

    getSecondsElapsed() {
        let total = this.state.previouslyAccumulatedSeconds;
        if (this.state.timerRunning) {
            const now = performance.now();
            total += 1e-3 * (now - this.state.timerStartMS);
        }
        return total;
    }

    guessStepsElapsedFromTime(timeDeltaSeconds) {
        // I did some linear regressions from real HD Italian runs. I'll put some data up at some point.
        let prediction = 156 + 252 * timeDeltaSeconds;
        if (this.state.includesLoadingTheRoom)
            prediction += -940 + Number(this.props.roomEnteredOffset);
        prediction += this.state.includedRewardsGotten * 760;
        return Math.round(prediction);
    }

    render() {
        const elapsed = this.getSecondsElapsed();
        if (this.state.invalidated)
            return <>
                <span style={{ fontSize: '150%', color: 'white', fontFamily: 'monospace' }}>TIMER</span>
                <span style={{ fontSize: '150%', color: 'white', fontFamily: 'monospace' }}>INVALIDATED</span>
            </>;
        return <>
            <span>&nbsp;Seconds elapsed: </span>
            <span>&nbsp;{elapsed.toFixed(2)}&nbsp;</span>
            <span>&nbsp;Steps:&nbsp;</span>
            <span>&nbsp;{this.guessStepsElapsedFromTime(elapsed)}&nbsp;</span>
            <span>&nbsp;Entered room:</span>
            <span>&nbsp;{renderYesNo(this.state.includesLoadingTheRoom)}&nbsp;</span>
            <span>&nbsp;Rewards gotten:&nbsp;</span>
            <span>&nbsp;{this.state.includedRewardsGotten}&nbsp;</span>
        </>;
            {/* &nbsp;- Rupees collected: {renderYesNo(this.state.rupeesCollected)} */};
    }
}

function computeL1Distance(p1, p2) {
    return Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
}

class MainMap extends React.Component {
    videoRef = React.createRef();
    canvasRef = React.createRef();
    //referenceCanvasRef = React.createRef();
    outputCanvasRef = React.createRef();
    hiddenAreaRef = React.createRef();
    layoutDrawingBoardRefs = [React.createRef(), React.createRef(), React.createRef()];
    timerRef = React.createRef();

    constructor() {
        super();
        this.state = this.makeEmptyState();
        this.bannerCache = new Map();
        window.RECOMP = () => {
            this.bannerCache = new Map();
            this.getBoardRegistrationAndScale();
        };
        globalMap = this;
        this.previouslyReadStates = [null, null, null];
    }

    componentDidMount() {
        this.makeReferenceImageCanvases();
        this.doComputation(this.state.grid, this.state.squidsGotten);
        //setTimeout(() => this.getScreenRecording(), 1000);
    }

    makeReferenceImageCanvases() {
        const hiddenArea = this.hiddenAreaRef.current;
        this.referenceCanvases = {};
        // 'top_banner', 'record_banner',
        for (const name of ['hit', 'miss', 'killed_squid', 'remaining_squid', 'top_banner_new', 'bottom_banner_new']) {
            const newCanvas = document.createElement('canvas');
            newCanvas.setAttribute('id', 'canvas_' + name);
            hiddenArea.appendChild(newCanvas);

            const newImage = document.createElement('img');
            newImage.src = process.env.PUBLIC_URL + '/images/' + name + '.png';
            newImage.onload = function() {
                newCanvas.width = this.width;
                newCanvas.height = this.height;
                const ctx = newCanvas.getContext('2d');
                ctx.drawImage(newImage, 0, 0);
            };
            this.referenceCanvases[name] = newCanvas;
        }
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = null;
        return grid;
    }

    makeEmptyState() {
        const probs = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                probs[[x, y]] = 0.0;
        // Select a particular layout, for practice mode.
        const squidLayout = generateLayout();
        return {
            mode: 'calculator',
            squidLayout,
            grid: this.makeEmptyGrid(),
            squidsGotten: 'unknown',
            undoBuffer: [],
            probs,
            best: [3, 3],
            cursorBelief: [3, 3],
            valid: true,
            observationProb: 1.0,
            screenRecordingActive: false,
            doVideoProcessing: false,
            lastComputationTime: -1,
            lastCVTime: -1,

            turboBlurboMode: false,
            turboBlurboTiming: false,
            showKeyShortcuts: false,

            timerStepEstimate: null,

            potentialMatches: [],
            firstBoardStepsThousands: 500,
            firstBoardStepsThousandsStdDev: 500,
            nextBoardStepsThousands: 7,
            nextBoardStepsThousandsStdDev: 3,
            timedBoardStepsThousandsStdDev: 0.2,
            roomEnteredOffset: 0,
        };
    }

    async startScreenRecording() {
        if (this.state.screenRecordingActive) {
            alert('Already screen capturing!');
            return;
        }
        const displayMediaOptions = {
            video: {
              cursor: "always",
            },
            audio: false,
        };
        const captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        const video = this.videoRef.current;
        video.srcObject = captureStream;
        video.play();
        this.setState({screenRecordingActive: true});
        // Ugh, super ugly. I should just wait for the video appropriately. The API gives a callback.
        // Please forgive me, it's 5 AM where I am, and Linkus starts in ~4 hours.
        await new Promise(resolve => setTimeout(resolve, 500));
        this.updateCapture();
        const canvas = this.canvasRef.current;
        const outputCanvas = this.outputCanvasRef.current;
        console.log(canvas, outputCanvas, canvas.width, canvas.height)
        outputCanvas.width = canvas.width;
        outputCanvas.height = canvas.height;
        const ctx = outputCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        /*
        setTimeout(
            () => this.getBoardRegistrationAndScale(),
            1000,
        );
        */
    }

    async initializeTurboBlurboMode(bigTable) {
        if (this.state.turboBlurboMode !== false)
            return;
        this.setState({turboBlurboMode: 'initializing'});
        this.boardIndices = await makeBoardIndicesTable();
        this.boardIndexToLayoutString = new Array(Object.keys(this.boardIndices).length);
        for (const key of Object.keys(this.boardIndices))
            this.boardIndexToLayoutString[this.boardIndices[key]] = key;

        const tableName = bigTable ? '/board_table_25M.bin' : '/board_table_5M.bin';
        dbCachedFetch(tableName, (buf) => {
            this.boardTable = new Uint32Array(buf);
            // Warning: Do I need to await wasm here first?
            console.log('Board table length:', this.boardTable.length);
            // Make sure every value is in range.
            for (const v of this.boardTable)
                if (v > 604583)
                    alert('BUG BUG BUG: Bad value in board table: ' + v);
            set_board_table(this.boardTable);
            this.setState({turboBlurboMode: true, squidsGotten: '0', mode: 'calculator'});
        });
    }

    toggleVideoProcessing() {
        if (!this.state.screenRecordingActive)
            return;
        if (this.state.doVideoProcessing === false && !this.readyToProcess()) {
            alert('You must first detect a board.');
            return;
        }
        this.setState({doVideoProcessing: !this.state.doVideoProcessing});
        // If we have a queued up board that hasn't verified as debounced yet, just process it.
        if (this.previouslyReadStates[this.previouslyReadStates.length - 1] !== null) {
            const resultantState = this.previouslyReadStates[this.previouslyReadStates.length - 1];
            this.setState(resultantState);
            this.doComputation(resultantState.grid, resultantState.squidsGotten);
            this.previouslyReadStates[this.previouslyReadStates.length - 1] = null;
        }
    }

    async getBoardRegistrationAndScale() {
        if (!this.state.screenRecordingActive)
            return;
        this.updateCapture();
        let bestGuessScale = 0.25 * 1.5; //0.5;
        let searchMargin = 0.7;
        for (let i = 0; i < 10; i++) {
            this.boardFitParams = await this.performGridSearch(
                bestGuessScale * (1 - searchMargin),
                bestGuessScale * (1 + 2 * searchMargin),
                i === 0 ? 20 : (i === 1 ? 10 : 4),
            );
            bestGuessScale = this.boardFitParams.scale;
            searchMargin /= 2;
        }
        console.log('Best fit params:', this.boardFitParams);
        // Force a rerender.
        this.bannerCache.delete(bestGuessScale);
        this.testForTopBannerAtScale(bestGuessScale);
        this.testForBottomBanner();
        console.log('Final fit params:', this.boardFitParams);
        await new Promise(resolve => setTimeout(resolve, 100));
        this.setState({doVideoProcessing: true});
        /*
        setTimeout(
            () => this.readBoardState(),
            250,
        )
        //*/
        //*
    }

    async performGridSearch(min, max, sampleCount) {
        let bestParams = {score: -1};
        for (let i = 0; i < sampleCount; i++) {
            const testScale = min + i * (max - min) / (sampleCount - 1);
            const params = this.testForTopBannerAtScale(testScale);
            if (params.score > bestParams.score)
                bestParams = params;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        console.log("Grid search over:", min, "to", max, "got:", bestParams);
        return bestParams;
    }

    testForBottomBanner() {
        const src = window.cv.imread('cv_canvasRef');

        const base_templ = window.cv.imread('canvas_bottom_banner_new');
        const scaled_banner_width = Math.round(base_templ.size().width * this.boardFitParams.scale);
        const scaled_banner_height = Math.round(base_templ.size().height * this.boardFitParams.scale);
        let templ = new window.cv.Mat();
        let dsize = new window.cv.Size(scaled_banner_width, scaled_banner_height);
        window.cv.resize(base_templ, templ, dsize, 0, 0, window.cv.INTER_AREA);

        const dst = new window.cv.Mat();
        const mask = new window.cv.Mat();
        const matchMode = window.cv.TM_CCOEFF_NORMED;
        window.cv.matchTemplate(src, templ, dst, matchMode, mask);
        let result = window.cv.minMaxLoc(dst, mask);
        let maxPoint = result.maxLoc;
        let color = new window.cv.Scalar(255, 0, 0, 255);
        let point = new window.cv.Point(maxPoint.x + templ.cols, maxPoint.y + templ.rows);
        window.cv.rectangle(src, maxPoint, point, color, 2, window.cv.LINE_8, 0);
        window.cv.imshow('cv_outputCanvasRef', src);
        src.delete(); base_templ.delete(); templ.delete(); dst.delete(); mask.delete();
        this.boardFitParams.bottomBannerOffset = {
            x: maxPoint.x, y: maxPoint.y,
        };
    }

    getCellXY(x, y) {
        const bannerVerticalSpacing = this.boardFitParams.bottomBannerOffset.y - this.boardFitParams.topBannerOffset.y;
        let aspectRatioFactor = bannerVerticalSpacing / (828 * this.boardFitParams.scale);
        if (aspectRatioFactor < 0.95 || aspectRatioFactor > 1.05)
            aspectRatioFactor = 1;

        //const aspectRatioFactor = 1.0;
        // Center of 0,0 cell: 161, 244
        // Center of 1,0 cell: 240, 244
        // Top of bottom banner: 832

        //let centerX = offsetX + scale * (105.25 + x * 52.2 + window.ADJUST_X);
        //let centerY = offsetY + scale * (155.75 + y * 52.2 + window.ADJUST_Y);
        return {
            x: this.boardFitParams.topBannerOffset.x + this.boardFitParams.scale * (161.5 + 75.5 * x),
            y: this.boardFitParams.topBannerOffset.y + this.boardFitParams.scale * aspectRatioFactor * (239 + 78.6 * y),
        };
    }

    getSquidIndicatorXY(y) {
        const bannerVerticalSpacing = this.boardFitParams.bottomBannerOffset.y - this.boardFitParams.topBannerOffset.y;
        let aspectRatioFactor = bannerVerticalSpacing / (828 * this.boardFitParams.scale);
        if (aspectRatioFactor < 0.95 || aspectRatioFactor > 1.05)
            aspectRatioFactor = 1;
        //const aspectRatioFactor = 1.0;
        // Center of 0,0 squid: 948, 188
        // Center of 1,0 squid: 948, 324

        return {
            x: this.boardFitParams.topBannerOffset.x + this.boardFitParams.scale * 948,
            y: this.boardFitParams.topBannerOffset.y + this.boardFitParams.scale * aspectRatioFactor * (185 + 133 * y),
        };
    }

    getBoardRect() {
        const bannerVerticalSpacing = this.boardFitParams.bottomBannerOffset.y - this.boardFitParams.topBannerOffset.y;
        let aspectRatioFactor = bannerVerticalSpacing / (828 * this.boardFitParams.scale);
        if (aspectRatioFactor < 0.95 || aspectRatioFactor > 1.05)
            aspectRatioFactor = 1;
        return new window.cv.Rect(
            Math.round(this.boardFitParams.topBannerOffset.x), Math.round(this.boardFitParams.topBannerOffset.y),
            Math.round(this.boardFitParams.scale * 1040),
            Math.round(this.boardFitParams.scale * aspectRatioFactor * 940),
        );
    }

    testForTopBannerAtScale(scale) {
        if (this.bannerCache.has(scale)) {
            return this.bannerCache.get(scale);
        }
        const src = window.cv.imread('cv_canvasRef');
        const base_templ = window.cv.imread('canvas_top_banner_new');

        const scaled_banner_width = Math.round(base_templ.size().width * scale);
        const scaled_banner_height = Math.round(base_templ.size().height * scale);
        let templ = new window.cv.Mat();
        let dsize = new window.cv.Size(scaled_banner_width, scaled_banner_height);
        window.cv.resize(base_templ, templ, dsize, 0, 0, window.cv.INTER_AREA);

        const dst = new window.cv.Mat();
        const mask = new window.cv.Mat();
        //const matchMode = window.cv.TM_CCOEFF_NORMED;
        const matchMode = window.cv.TM_CCOEFF_NORMED;
        window.cv.matchTemplate(src, templ, dst, matchMode, mask);
        let result = window.cv.minMaxLoc(dst, mask);
        let maxPoint = result.maxLoc;
        let color = new window.cv.Scalar(255, 0, 0, 255);
        let point = new window.cv.Point(maxPoint.x + templ.cols, maxPoint.y + templ.rows);
        window.cv.rectangle(src, maxPoint, point, color, 2, window.cv.LINE_8, 0);
        window.cv.imshow('cv_outputCanvasRef', src);
        src.delete(); base_templ.delete(); templ.delete(); dst.delete(); mask.delete();

        let score = result.maxVal;
        this.bannerCache.set(scale, score);
        return {
            score, scale,
            topBannerOffset: {x: maxPoint.x, y: maxPoint.y},
        };
    }

    readyToProcess() {
        return this.state.screenRecordingActive &&
            this.boardFitParams !== undefined &&
            this.boardFitParams.hasOwnProperty('bottomBannerOffset');
    }

    async readBoardState() {
        if (!this.readyToProcess())
            return;

        const resultantState = {
            grid: {},
            squidsGotten: 0,
        };

        this.updateCapture();
        const t0 = performance.now();

        const src = window.cv.imread('cv_canvasRef');
        const ksize = new window.cv.Size(3, 3);
        window.cv.GaussianBlur(src, src, ksize, 0, 0, window.cv.BORDER_DEFAULT);
        const toDelete = [src];

        const getPixelColor = (x, y) => {
            const pixelPtr = src.ucharPtr(Math.round(y), Math.round(x));
            const pixelColor = {r: pixelPtr[0], g: pixelPtr[1], b: pixelPtr[2]};
            const energy = Math.sqrt(pixelColor.r * pixelColor.r + pixelColor.g * pixelColor.g + pixelColor.b * pixelColor.b);
            return {...pixelColor, energy};
        };

        // Extract the info.
        let nothingColor        = new window.cv.Scalar(80,  80,  80,  255);
        let hitColor            = new window.cv.Scalar(255, 0,   255, 255);
        let missColor           = new window.cv.Scalar(100, 255, 0,   255);
        let killedSquidColor    = new window.cv.Scalar(255, 100, 100, 255);
        let remainingSquidColor = new window.cv.Scalar(50,  255, 100, 255);
        let mostLikelyCursorLocation = null;
        let bestCursorScore = -1;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const cellXY = this.getCellXY(x, y);
                const wayDown = getPixelColor(cellXY.x, cellXY.y + 15);
                if (wayDown.energy > bestCursorScore) {
                    bestCursorScore = wayDown.energy;
                    mostLikelyCursorLocation = {x, y};
                }
            }
        }
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const cellXY = this.getCellXY(x, y);
                const centerX = cellXY.x;
                const centerY = cellXY.y;

                // WARNING: This isn't appropriately scale insensitive.
                const D = 2;
                //const farD = 3;
                const center     = getPixelColor(centerX,        centerY);
                const upLeft     = getPixelColor(centerX - D,    centerY - D);
                const upRight    = getPixelColor(centerX + D,    centerY - D);
                const downLeft   = getPixelColor(centerX - D,    centerY + D);
                const downRight  = getPixelColor(centerX + D,    centerY + D);
                const probablyInsideCursor = x === mostLikelyCursorLocation.x && y === mostLikelyCursorLocation.y;
                // This variable says if we think our left side is likely corrupted by the cursor's halo.
                const cursorHaloLeft  = probablyInsideCursor || (x === mostLikelyCursorLocation.x + 1 && y === mostLikelyCursorLocation.y);
                const cursorHaloRight = probablyInsideCursor || (x === mostLikelyCursorLocation.x - 1 && y === mostLikelyCursorLocation.y);
                const cursorHaloUp    = probablyInsideCursor || (x === mostLikelyCursorLocation.x && y === mostLikelyCursorLocation.y + 1);
                const cursorHaloDown  = probablyInsideCursor || (x === mostLikelyCursorLocation.x && y === mostLikelyCursorLocation.y - 1);
                const cursorHaloUL = cursorHaloUp   || cursorHaloLeft;
                const cursorHaloUR = cursorHaloUp   || cursorHaloRight;
                const cursorHaloDL = cursorHaloDown || cursorHaloLeft;
                const cursorHaloDR = cursorHaloDown || cursorHaloRight;
                
                let color = nothingColor;

                let threshold = probablyInsideCursor ? 240 : 220;
                const passingCount = (
                    (center.energy    >= threshold) +
                    (upLeft.energy    >= (cursorHaloUL ? 240 : 220)) +
                    (upRight.energy   >= (cursorHaloUR ? 240 : 220)) +
                    (downLeft.energy  >= (cursorHaloDL ? 240 : 220)) +
                    (downRight.energy >= (cursorHaloDL ? 240 : 220))
                );
                const greenerMargin = probablyInsideCursor ? 1 : 1.02;
                const greenerThanBlueCount = (
                    (center.g    >= center.b *    greenerMargin) +
                    (upLeft.g    >= upLeft.b *    (cursorHaloUL ? greenerMargin : 1.05)) +
                    (upRight.g   >= upRight.b *   (cursorHaloUR ? greenerMargin : 1.05)) +
                    (downLeft.g  >= downLeft.b *  (cursorHaloDL ? greenerMargin : 1.05)) +
                    (downRight.g >= downRight.b * (cursorHaloDR ? greenerMargin : 1.05))
                );
                // There's an obnoxious light in this cell, so we have to special case it.
                //const disqualified = x === 4 && y === 6 && center.energy < 200;
                resultantState.grid[[x, y]] = null;
                if (
                    (passingCount >= 4 && greenerThanBlueCount >= 3) || (passingCount >= 3 && greenerThanBlueCount >= 4)
                ) {
                    const maxRed   = Math.max(center.r, upLeft.r, upRight.r, downLeft.r, downRight.r);
                    const maxGreen = Math.max(center.g, upLeft.g, upRight.g, downLeft.g, downRight.g);
                    if (maxRed > maxGreen * 1.25) {
                        color = hitColor
                        resultantState.grid[[x, y]] = 'HIT';
                    } else {
                        color = missColor;
                        resultantState.grid[[x, y]] = 'MISS';
                    }
                }
                if (window.JUST_ONCE) {
                    // Debugging code, please ignore this.
                    if (probablyInsideCursor)
                        console.log('INSIDE!!!!!');
                    console.log('Scores:', x, y, probablyInsideCursor, greenerThanBlueCount, center, upLeft, upRight, downLeft, downRight);
                }
                let tl = new window.cv.Point(centerX - 7, centerY - 7);
                let br = new window.cv.Point(centerX + 7, centerY + 7);
                window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);
            }
        }
        for (let squidIndex = 0; squidIndex < 3; squidIndex++) {
            const cellXY = this.getSquidIndicatorXY(squidIndex);
            const centerX = cellXY.x;
            const centerY = cellXY.y;
            const pixelPtr = src.ucharPtr(Math.round(centerY), Math.round(centerX));
            const pixelColor = {r: pixelPtr[0], g: pixelPtr[1], b: pixelPtr[2]};
            let tl = new window.cv.Point(centerX - 15, centerY - 15);
            let br = new window.cv.Point(centerX + 15, centerY + 15);
            let color = remainingSquidColor;
            if (pixelColor.r > pixelColor.b * 1.25) {
                color = killedSquidColor;
                resultantState.squidsGotten = Math.max(resultantState.squidsGotten, squidIndex + 1);
            }

            window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);
        }
        const boardRect = this.getBoardRect();
        const srcCrop = src.roi(boardRect);
        toDelete.push(srcCrop);
        window.cv.imshow('cv_outputCanvasRef', srcCrop);
        for (const mat of toDelete)
            mat.delete();
        const t1 = performance.now();
        console.log('CV took: ' + (t1 - t0) + 'ms');
        this.setState({lastCVTime: t1 - t0});

        function compareStatesEqual(A, B) {
            if (A === null || B === null)
                return false;
            let allEqual = A.squidsGotten  === B.squidsGotten;
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++)
                    if (A.grid[[x, y]] !== B.grid[[x, y]])
                        allEqual = false;
            return allEqual
        }

        // Only recompute if we see states of the form: ABBB (that is, three in a row for debouncing, plus a change).
        if (
            (!compareStatesEqual(this.previouslyReadStates[0], this.previouslyReadStates[1])) &&
            compareStatesEqual(this.previouslyReadStates[1], this.previouslyReadStates[2]) &&
            compareStatesEqual(this.previouslyReadStates[2], resultantState)
        ) {
            this.setState(resultantState);
            await this.doComputation(resultantState.grid, resultantState.squidsGotten);
        }
        this.previouslyReadStates.shift();
        this.previouslyReadStates.push(resultantState);

        return resultantState;
    }

    updateCapture() {
        const video = this.videoRef.current;
        const canvas = this.canvasRef.current;
        //const referenceCanvas = this.referenceCanvasRef.current;
        //const outputCanvas = this.outputCanvasRef.current;
        const context = canvas.getContext('2d');
        //const width = video.width;
        //const height = video.height;
        const width = 960;
        const height = Math.round(width * (video.videoHeight / video.videoWidth));
        console.log('Native image capture shape: ' + video.videoWidth + 'x' + video.videoHeight + ' -> scaling to: ' + width + 'x' + height);
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
    }

    *findMatchingLocations(observedBoards, startIndex, scanRange) {
        if (observedBoards.length === 0) {
            yield [];
            return;
        }
        // Try to find the first match.
        const soughtBoard = observedBoards[0];
        const boardTable = this.boardTable;
        const indexMax = Math.min(boardTable.length, startIndex + scanRange);
        for (let i = startIndex; i < indexMax; i++)
            if (boardTable[i] === soughtBoard)
                for (const subResult of this.findMatchingLocations(observedBoards.slice(1), i, 15000))
                    yield [i, ...subResult];
    }

    recomputePotentialMatches() {
        const [observedBoards, _1, _2] = this.makeGameHistoryArguments();
        const matches = [];
        for (const match of this.findMatchingLocations(observedBoards, 0, 1000000000))
            matches.push(match);
        this.setState({potentialMatches: matches});
    }

    makeGameHistoryArguments() {
        // Figure out how many history boards we have.
        const rawObservedBoards = this.layoutDrawingBoardRefs
            .map((ref) => this.boardIndices[ref.current.getLayoutString()]);
        const observedBoards = [];
        for (const ob of rawObservedBoards) {
            if (ob === undefined)
                break;
            observedBoards.push(ob);
        }

        // The optimal thing to do here is to save the sequence of step delta estimates, but to make
        // the tool less fragile we only use our timer-based estimates for the very final mean.

        const priorStepsFromPreviousMeans = [];
        const priorStepsFromPreviousStdDevs = [];
        let first = true;
        for (const index of [...observedBoards, null]) {
            if (index === undefined)
                break;
            if (first) {
                priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.firstBoardStepsThousands));
                priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.firstBoardStepsThousandsStdDev));
            } else {
                // If we're the last delta, and also not the first, then possibly use our time delta.
                if (index === null && this.state.timerStepEstimate !== null) {
                    // Because the timerStepEstimate can be negative I have to avoid underflow.
                    priorStepsFromPreviousMeans.push(Math.max(0, this.state.timerStepEstimate));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.timedBoardStepsThousandsStdDev));
                } else {
                    priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.nextBoardStepsThousands));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.nextBoardStepsThousandsStdDev));
                }
            }
            first = false;
        }
        return [
            Uint32Array.from(observedBoards),
            Uint32Array.from(priorStepsFromPreviousMeans),
            Float64Array.from(priorStepsFromPreviousStdDevs),
        ];
    }

    getGridStatistics(grid, squidsGotten) {
        const hits = [];
        const misses = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const gridValue = grid[[x, y]];
                if (gridValue === 'HIT')
                    hits.push(8 * y + x);
                if (gridValue === 'MISS')
                    misses.push(8 * y + x);
            }
        }
        let numericSquidsGotten = -1;
        for (const n of ['0', '1', '2', '3'])
            if (squidsGotten === n || squidsGotten === Number(n))
                numericSquidsGotten = Number(n);
        return {hits, misses, numericSquidsGotten};
    }

    async doComputation(grid, squidsGotten) {
        console.log('Doing computation:', squidsGotten, grid);
        const t0 = performance.now();
        const {hits, misses, numericSquidsGotten} = this.getGridStatistics(grid, squidsGotten);

        await wasm;
        let probabilities;
        if (this.state.turboBlurboMode) {
            const gameHistoryArguments = this.makeGameHistoryArguments();
            console.log('gameHistoryArguments:', gameHistoryArguments);

            probabilities = calculate_probabilities_from_game_history(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
                ...gameHistoryArguments,
            );
        } else {
            probabilities = calculate_probabilities_with_board_constraints(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
                // No constraints for now.
                Uint32Array.from([]),
                Float64Array.from([]),
            );
        }

        if (probabilities !== undefined) {
            let maxY = 0;
            let maxX = 0;
            let highestProb = -1;
            let probs = [];

            // Here we implement our L1 distance bonus heuristic.
            // The idea is that we want to highlight a square that isn't too far from where
            // the player last adjusted the board. (i.e. where we believe their cursor is.)
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    probs[[x, y]] = probabilities[8 * y + x];
                    const l1Distance = computeL1Distance(this.state.cursorBelief, [x, y]);
                    const distancePenaltyMultiplier = 1 - 0.03 * l1Distance;
                    const distanceAdjustedProb = probabilities[8 * y + x] * distancePenaltyMultiplier;
                    if (grid[[x, y]] === null && distanceAdjustedProb > highestProb) {
                        highestProb = distanceAdjustedProb;
                        maxX = x;
                        maxY = y;
                    }
                }
            }
            const observationProb = probabilities[64];
            this.setState({ probs, best: highestProb >= 0 ? [maxX, maxY] : null, valid: true, observationProb });
        } else {
            this.setState({ valid: false });
        }
        const t1 = performance.now();
        this.setState({lastComputationTime: t1 - t0});
    }

    copyToUndoBuffer() {
        this.setState({undoBuffer: [
            ...this.state.undoBuffer,
            {grid: this.state.grid, squidsGotten: this.state.squidsGotten, cursorBelief: this.state.cursorBelief},
        ]});
    }

    onClick(x, y, setAsHit) {
        const grid = { ...this.state.grid };
        let gridValue = grid[[x, y]];
        let squidsGotten = this.state.squidsGotten;
        this.copyToUndoBuffer();

        if (this.state.mode === 'calculator') {
            switch (gridValue) {
                case null:
                    gridValue = setAsHit ? 'HIT' : 'MISS';
                    break;
                case 'MISS':
                    gridValue = 'HIT';
                    break;
                case 'HIT':
                    gridValue = null;
                    break;
            }
            grid[[x, y]] = gridValue;
        } else {
            // Determine from the random layout.
            if (gridValue !== null)
                return;
            const arrayContains = (arr) => {
                for (const cell of arr)
                    if (cell[0] === x && cell[1] === y)
                        return true;
                return false;
            }
            if (arrayContains([...this.state.squidLayout.squid2, ...this.state.squidLayout.squid3, ...this.state.squidLayout.squid4])) {
                gridValue = 'HIT';
            } else {
                gridValue = 'MISS';
            }
            grid[[x, y]] = gridValue;
            // Compute the killed squid count.
            squidsGotten = 0;
            for (const n of ['2', '3', '4']) {
                const squid = this.state.squidLayout['squid' + n];
                let killed = true;
                for (const cell of squid)
                    if (grid[cell] !== 'HIT')
                        killed = false;
                squidsGotten += killed;
            }
            this.setState({ squidsGotten });
        }
        this.setState({grid, cursorBelief: [x, y]});
        this.doComputation(grid, squidsGotten);
    }

    clearField() {
        const templateState = this.makeEmptyState();
        const newState = {};
        for (const name of ['squidLayout', 'grid', 'squidsGotten', 'undoBuffer', 'cursorBelief'])
            newState[name] = templateState[name];
        // The squidsGotten value of 'unknown' is banned in turbo blurbo mode.
        if (this.state.turboBlurboMode)
            newState.squidsGotten = '0';
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
    }

    undoLastMarking() {
        const undoBuffer = [...this.state.undoBuffer];
        if (undoBuffer.length === 0)
            return;
        const undoEntry = undoBuffer.pop();
        this.setState({grid: undoEntry.grid, squidsGotten: undoEntry.squidsGotten, cursorBelief: undoEntry.cursorBelief, undoBuffer});
        this.doComputation(undoEntry.grid, undoEntry.squidsGotten);
    }

    reportMiss() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null)
            this.onClick(...this.state.best);
    }

    reportHit() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null)
        {
            this.onClick(...this.state.best, true);
            const {hits, misses, numericSquidsGotten} = this.getGridStatistics(this.state.grid, this.state.squidsGotten);
            if (hits.length === 9) {
                this.incrementKills();
            }
        }
    }

    splitTimer() {
        const boardTimer = this.timerRef.current;
        if (boardTimer === null)
            return;
        const timerStepEstimate = boardTimer.state.invalidated ? null : boardTimer.guessStepsElapsedFromTime(boardTimer.getSecondsElapsed());
        this.setState({timerStepEstimate});
        console.log('Timer step estimate:', timerStepEstimate);
        boardTimer.setState({
            previouslyAccumulatedSeconds: 0.0,
            timerStartMS: performance.now(),
            // After the first split we're no longer loading the room.
            includesLoadingTheRoom: false,
            includedRewardsGotten: 0,
            timerRunning: true,
            invalidated: false,
        });
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    async incrementKills() {
        this.copyToUndoBuffer();
        let numericValue = this.state.squidsGotten === 'unknown' ? 0 : Number(this.state.squidsGotten);
        let grid = this.state.grid;
        numericValue++;
        if (numericValue === 4) {
            // TODO: Think very carefully about this timer splitting, and if and when it should happen.
            const gameHistoryArguments = this.makeGameHistoryArguments();
            this.splitTimer();
            const success = await this.copyToHistory(gameHistoryArguments);
            if (success) {
                numericValue = 0;
                grid = this.makeEmptyGrid();
                // FIXME: Make us able to undo across completions.
                this.setState({undoBuffer: [], cursorBelief: [3, 3]});
            } else {
                numericValue = 3;
            }
        }
        this.setState({grid, squidsGotten: '' + numericValue});
        this.doComputation(grid, '' + numericValue);
    }

    async copyToHistory(gameHistoryArguments) {
        const {hits} = this.getGridStatistics(this.state.grid, this.state.squidsGotten);
        if (gameHistoryArguments === undefined)
            gameHistoryArguments = this.makeGameHistoryArguments();
        await wasm;
        const finalBoard = disambiguate_final_board(
            Uint8Array.from(hits),
            ...gameHistoryArguments,
        );
        if (finalBoard === undefined) {
            // TODO: Show a proper error message in this case!
            //alert('Ambiguous!');
            return false;
        }
        console.log('Final board:', finalBoard);
        const layoutString = this.boardIndexToLayoutString[finalBoard];
        const observedBoards = gameHistoryArguments[0];
        let fillIndex = observedBoards.length;
        // If we're already at capacity then we have to shift the boards over.
        if (fillIndex === this.layoutDrawingBoardRefs.length) {
            this.shiftHistory();
            fillIndex--;
        }
        this.layoutDrawingBoardRefs[fillIndex].current.setStateFromLayoutString(layoutString);
        return true;
    }

    shiftHistory() {
        const drawingBoards = this.layoutDrawingBoardRefs.map((ref) => ref.current);
        for (let i = 0; i < drawingBoards.length -1; i++) {
            drawingBoards[i].setState(drawingBoards[i + 1].state);
        }
        drawingBoards[drawingBoards.length - 1].clearBoard();
    }

    renderActualMap(overlayMode) {
        return <div style={{justifySelf: 'center'}}>
            {naturalsUpTo(8).map(
                (y) => <div key={y} style={{
                    display: 'flex',
                }}>
                    {naturalsUpTo(8).map(
                        (x) => <Tile
                            key={x + ',' + y}
                            x={x} y={y}
                            onClick={() => this.onClick(x, y)}
                            text={this.state.grid[[x, y]]}
                            prob={this.state.probs[[x, y]]}
                            valid={this.state.valid}
                            best={this.state.best}
                            precision={overlayMode ? 0 : 2}
                            opacity={overlayMode ? 0.5 + 0.3 * this.state.probs[[x, y]] : undefined}
                        />
                    )}
                </div>
            )}
        </div>;
    }

    renderOverlayMap() {
        if (!this.state.doVideoProcessing)
            return;
        return <div style={{
            position: 'absolute',
            top: '210px',
            left: '127px',
            transform: 'scale(1.01, 1.05)',
            zIndex: 20,
            display: 'inline-block',
            /* opacity: 0.4, */
        }}>
            {this.renderActualMap(true)}
        </div>;
    }

    render() {
        let usedShots = 0;
        let openingOptimizer = true;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (this.state.grid[[x, y]] !== null) {
                    usedShots++;
                    if (this.state.grid[[x, y]] === 'HIT')
                        openingOptimizer = false;
                }
            }
        }
        return <div style={{
            margin: '20px',
            color: 'white',
        }}>
            <div className="container">
                <div style={{justifySelf: "end", alignSelf: "start"}}>
                    <div className="tableContainer" style={{gridTemplateColumns: "repeat(2, 1fr)"}}>
                        <span><strong>&nbsp;Item&nbsp;</strong></span>
                        <span><strong>&nbsp;Value&nbsp;</strong></span>
                        <span>&nbsp;Shots used:&nbsp;</span>
                        <span>&nbsp;{usedShots}&nbsp;</span>
                    {this.state.turboBlurboMode && this.state.turboBlurboTiming && 
                    <>
                        <BoardTimer ref={this.timerRef} roomEnteredOffset={this.state.roomEnteredOffset} />
                        <span>&nbsp;Last steps:&nbsp;</span>
                        <span>&nbsp;{this.state.timerStepEstimate === null ? '-' : this.state.timerStepEstimate}&nbsp;</span>
                    </>
                    }
                    {this.state.turboBlurboMode && this.state.turboBlurboTiming && this.state.showKeyShortcuts &&
                    <>
                        <span><strong>&nbsp;Control&nbsp;</strong></span><span><strong>&nbsp;Shortcut&nbsp;</strong></span>
                        <span>&nbsp;Toggle Timer&nbsp;</span><span>&nbsp;Space&nbsp;</span>
                        <span>&nbsp;Add Reward&nbsp;</span><span>&nbsp;,&nbsp;</span>
                        <span>&nbsp;Remove Reward&nbsp;</span><span>&nbsp;&lt;&nbsp;</span>
                        <span>&nbsp;Toggle Room Entered&nbsp;</span><span>&nbsp;m&nbsp;</span>
                        <span>&nbsp;Invalidate Timer&nbsp;</span><span>&nbsp;;&nbsp;</span>
                        <span>&nbsp;Reset Timer&nbsp;</span><span>&nbsp;:&nbsp;</span>
                        <span>&nbsp;Split Timer&nbsp;</span><span>&nbsp;s&nbsp;</span>
                    </>
                    }
                    </div>
                    {this.state.turboBlurboMode && this.state.turboBlurboTiming &&
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.setState({showKeyShortcuts: !this.state.showKeyShortcuts}) }}>Toggle Show Shortcuts</button>
                    }
                </div>
            {this.state.doVideoProcessing || this.renderActualMap(false)}
            <span style={{display: "inline-block"}}></span>
            </div>
            {this.state.valid || this.state.turboBlurboMode || <div style={{ fontSize: '150%', color: 'white' }}>Invalid configuration! This is not possible.</div>}
            <br />
            <div style={{ fontSize: '150%' }}>
                <span style={{ color: 'white' }}>Number of squids killed:</span>
                <select
                    style={{ marginLeft: '20px', fontSize: '100%' }}
                    value={this.state.squidsGotten}
                    onChange={(event) => {
                        this.setState({ squidsGotten: event.target.value });
                        this.doComputation(this.state.grid, event.target.value);
                    }}
                >
                    {/* In turbo blurbo mode don't allow unknown, because it's just an accident waiting to happen for a runner. */}
                    {
                        this.state.turboBlurboMode ||
                        <option value="unknown">Unknown</option>
                    }
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                </select>
                <br />
                {/*
                <span style={{color: 'white', fontSize: '80%'}}>
                    Probability of this pattern yielding these results: {(100 * this.state.observationProb).toFixed(2) + '%'}
                </span>
                */}
            </div>
            <br/>
            {
                this.state.turboBlurboMode &&
                <>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportMiss(); }}>Miss (z)</button>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportHit(); }}>Hit (x)</button>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.copyToHistory(); }}>Copy to History (h)</button>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.shiftHistory(); }}>Shift History</button>
                </>
            }
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.incrementKills(); }}>Increment Kills (c)</button>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.clearField(); }}>Reset</button>
            {
                this.state.turboBlurboMode ||
                <select
                    style={{ marginLeft: '20px', fontSize: '150%' }}
                    value={this.state.mode}
                    onChange={(event) => this.setState({ mode: event.target.value })}
                >
                    <option value="calculator">Calculator Mode</option>
                    <option value="practice">Practice Mode</option>
                </select>
            }
            {
                this.state.turboBlurboMode &&
                <div style={{display: 'inline-block', margin: '10px', border: '1px solid white', borderRadius: '5px', fontSize: '130%', padding: '5px'}}>
                    <span style={{margin: '5px'}}>Timer mode:</span>
                    <input
                        type="checkbox"
                        checked={this.state.turboBlurboTiming}
                        onChange={(event) => this.setState({ turboBlurboTiming: !this.state.turboBlurboTiming })}
                        style={{
                            margin: '10px',
                            transform: 'scale(2)',
                        }}
                    />
                </div>
            }
            <br />
            {openingOptimizer && (!this.state.screenRecordingActive) && this.state.mode === 'calculator' && (!this.state.turboBlurboMode) && <>
                <div style={{ color: 'white', fontSize: '120%', marginTop: '20px' }}>
                    Opening optimizer: Probability that this<br />pattern would get at least one hit: {
                        this.state.valid ? ((100 * Math.max(0, 1 - this.state.observationProb)).toFixed(2) + '%') : "Invalid"
                    }
                </div>
            </>}
            <br/>
            <hr/>
            {this.state.turboBlurboMode === 'initializing' && <div style={{ fontSize: '150%', color: 'white' }}>Downloading table...<br/></div>}
            {this.state.turboBlurboMode === true && <>
                <div>
                    {this.layoutDrawingBoardRefs.map((ref, i) =>
                        <LayoutDrawingBoard parent={this} ref={ref} key={i}/>
                    )}
                </div>
                <div style={{color: 'white', fontSize: '130%'}}>
                    Gaussian RNG step count beliefs (all counts in <i>thousands</i> of steps, except "Room entered offset"):<br/>
                    First board mean:    <input style={{width: '50px'}} value={this.state.firstBoardStepsThousands}       onChange={event => this.setState({firstBoardStepsThousands: event.target.value})}/> &nbsp;
                    First board stddev:  <input style={{width: '50px'}} value={this.state.firstBoardStepsThousandsStdDev} onChange={event => this.setState({firstBoardStepsThousandsStdDev: event.target.value})}/> &nbsp;
                    Next board mean:     <input style={{width: '50px'}} value={this.state.nextBoardStepsThousands}        onChange={event => this.setState({nextBoardStepsThousands: event.target.value})}/> &nbsp;
                    Next board stddev:   <input style={{width: '50px'}} value={this.state.nextBoardStepsThousandsStdDev}  onChange={event => this.setState({nextBoardStepsThousandsStdDev: event.target.value})}/> &nbsp;
                    Timed board stddev:  <input style={{width: '50px'}} value={this.state.timedBoardStepsThousandsStdDev} onChange={event => this.setState({timedBoardStepsThousandsStdDev: event.target.value})}/>&nbsp;
                    Room entered offset: <input style={{width: '50px'}} value={this.state.roomEnteredOffset}              onChange={event => this.setState({roomEnteredOffset: event.target.value})}/>
                </div>
                <div style={{margin: '20px', color: 'white', fontSize: '130%', border: '1px solid white', width: '400px', minHeight: '20px', display: 'inline-block'}}>
                    {this.state.potentialMatches.map((match, i) => {
                        const diffs = match.slice(1);
                        return <div key={i}>
                            Potential match: {match[0]}{diffs.map((x, i) => <> +{x - match[i]}</>)}
                        </div>;
                    })}
                </div><br/>
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.recomputePotentialMatches(); }}>Find Match Indices</button>
                <div style={{ fontSize: '150%', color: 'white' }}>Turbo blurbo mode initialized.<br/></div>
            </>}
            <button disabled={this.state.turboBlurboMode !== false} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.initializeTurboBlurboMode(false);
            }}>Initialize Turbo Blurbo Mode</button><br/>
            <button disabled={this.state.turboBlurboMode !== false} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.initializeTurboBlurboMode(true);
            }}>Initialize Turbo Blurbo Mode (big table)</button><br/>

            {/*
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.startScreenRecording();
            }}>Start Screen Cap</button>
            <button disabled={!this.state.screenRecordingActive} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.bannerCache = new Map();
                this.getBoardRegistrationAndScale();
            }}>Detect Board</button>
            <button disabled={!this.state.screenRecordingActive} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.toggleVideoProcessing();
            }}>{this.state.doVideoProcessing ? 'Stop Processing (p)' : 'Start Processing (p)'}</button><br />

            <video style={{display: 'none'}} ref={this.videoRef}>Video stream not available.</video>
            <canvas style={{display: 'none'}} ref={this.canvasRef} id="cv_canvasRef"></canvas>
            <div style={{display: 'inline-block'}}>
                <div style={{
                    display: 'inline-block',
                    position: 'relative',
                }}>
                    <canvas style={{
                        border: this.state.doVideoProcessing ? '5px solid red' : '5px solid blue',
                        width: '1000px',
                    }} ref={this.outputCanvasRef} id="cv_outputCanvasRef"></canvas>
                    {this.renderOverlayMap()}
                </div>
            </div>
            <br/>
            */}
            {/* <span style={{ color: 'white' }}>Last CV time: {this.state.lastCVTime}ms - Last recompute time: {this.state.lastComputationTime}ms</span> */}
            <span style={{ color: 'white' }}>Last recompute time: {this.state.lastComputationTime}ms</span>
            <div style={{display: 'none'}} ref={this.hiddenAreaRef}></div>
        </div>;
    }
}

function globalShortcutsHandler(evt) {
    if (evt.key === 'p' && globalMap !== null)
        globalMap.toggleVideoProcessing();

    // Add z or y for German keyboard support.
    if (evt.key === 'z' && evt.ctrlKey)
        globalMap.undoLastMarking();
    else if ((evt.key === 'z' || evt.key === 'y')  && globalMap !== null)
        globalMap.reportMiss();
    if (evt.key === 'x' && globalMap !== null)
        globalMap.reportHit();
    if (evt.key === 'c' && globalMap !== null)
        globalMap.incrementKills();
    if (evt.key === 's' && globalMap !== null)
        globalMap.splitTimer();
    if (evt.key === 'h' && globalMap !== null)
        globalMap.copyToHistory();

    if (evt.key === ' ' && globalBoardTimer !== null) {
        globalBoardTimer.toggleRunning();
        evt.preventDefault();
    }
    if (evt.key === ',' && globalBoardTimer !== null)
        globalBoardTimer.adjustRewards(+1);
    if (evt.key === '<' && globalBoardTimer !== null)
        globalBoardTimer.adjustRewards(-1);
    if (evt.key === 'm' && globalBoardTimer !== null)
        globalBoardTimer.toggleLoadingTheRoom();
    if (evt.key === ';' && globalBoardTimer !== null)
        globalBoardTimer.toggleInvalidated();
    if (evt.key === ':' && globalBoardTimer !== null)
        globalBoardTimer.resetTimer();
}

document.addEventListener('keydown', globalShortcutsHandler);

class App extends React.Component {
    componentDidMount() {
        document.body.style.backgroundColor = '#666';
        /*
        const opencvScript = document.createElement('script');
        opencvScript.addEventListener('load', )
        opencvScript.setAttribute('src', '');
        */
    }

    render() {
        return <div style={{
            textAlign: 'center',
        }}>
            <div style={{ display: 'inline-block', width: '600px' }}>
                <h1 style={{ color: 'white' }}>Sploosh Kaboom Probability Calculator</h1>
                <p style={{ color: 'white' }}>
                    This page gives exact probabilities (no approximation) of hitting a squid in each cell, given the observation of hits, misses, and completed squid kills.
                    Click on the map to cycle a cell between HIT and MISS.
                    You can also set the number of squids completely killed in the drop-down menu at the bottom.
                    You should set this to the value you see in the game for the number of squids killed.
                    This will yield slightly more accurate probabilities.
                    The highest probability location to play will be shown with a yellow outline.
                    If you play perfectly according to picking the highlighted cell you will win in 20 or fewer shots ≈18.5% of the time.
                </p>
            </div>
            <MainMap />
            <span style={{ color: 'white' }}>Made by Peter Schmidt-Nielsen and CryZe (v0.0.17)</span><br/>
            <span style={{ color: 'white' }}><a href="https://github.com/petersn/web-sploosh-kaboom">GitHub Repository</a></span>
        </div>;
    }
}

export default App;
