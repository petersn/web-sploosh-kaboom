import React from 'react';
import './App.css';
import $ from 'jquery';
import init, {
    set_board_table,
    calculate_probabilities_with_board_constraints,
    calculate_probabilities_from_game_history,
} from './wasm/sploosh_wasm.js';
import { findAllByPlaceholderText } from '@testing-library/react';
import NumericInput from 'react-numeric-input';
const interpolate = require('color-interpolate');


//const colormap = interpolate(['#004', '#090', '#0a0', 'green']);
//const colormap = interpolate(['#004', '#0a0', '#0d0', '#0f0', '#6f6']);
// .        . . . .
// 0123456789abcdef
const colormap = interpolate(['#004', '#070', '#090', '#0b0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] == this.props.x && this.props.best[1] == this.props.y;

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

function makeBoardIndicesTable() {
    /*
    // Cache in localStorage
    const keyName = 'BoardIndicesTable';
    const fromCache = window.localStorage.getItem(keyName);
    if (fromCache !== null)
        return JSON.parse(fromCache);
    const value = rawMakeBoardIndicesTable();
    window.localStorage.setItem(keyName, JSON.stringify(value));
    return value;
    */
    return rawMakeBoardIndicesTable();
    /*
    const req = new XMLHttpRequest();
    req.open('GET', process.env.PUBLIC_URL + '/board_indices.json', false);
    req.send(null);
    return JSON.parse(req.responseText);
    */
}

function rawMakeBoardIndicesTable() {
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
    globalProcessingTick();
    /*
    setInterval(
        () => {
            
        },
        50,
    );
    */
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
    console.log('Generated:', layout);
    return layout;
}

class LayoutDrawingBoard extends React.Component {
    constructor() {
        super();
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = '.';
        this.state = { grid };
    }

    onClick(x, y) {
        const grid = {...this.state.grid};
        switch (grid[[x, y]]) {
            case '.': grid[[x, y]] = '2'; break;
            case '2': grid[[x, y]] = '3'; break;
            case '3': grid[[x, y]] = '4'; break;
            case '4': grid[[x, y]] = '.'; break;
        }
        this.setState({ grid });
    }

    getLayoutString() {
        let layoutString = '';
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                layoutString += this.state.grid[[x, y]];
        return layoutString;
    }

    render() {
        const layoutString = this.getLayoutString();
        let boardIndex = this.props.parent.boardIndices[layoutString];

        return <div style={{
            margin: '20px',
            display: 'inline-block',
            color: 'white',
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
                            best={false}
                            fontSize={'200%'}
                        />
                    )}
                </div>
            )}<br/>
            Squid Layout: {boardIndex}
        </div>;
    }
}

class MainMap extends React.Component {
    videoRef = React.createRef();
    canvasRef = React.createRef();
    //referenceCanvasRef = React.createRef();
    outputCanvasRef = React.createRef();
    hiddenAreaRef = React.createRef();
    layoutDrawingBoardRefs = [React.createRef(), React.createRef(), React.createRef()];

    constructor() {
        super();
        this.state = this.makeEmptyState();
        this.bannerCache = new Map();
        this.doComputation(this.state.grid, this.state.squidsGotten);
        window.RECOMP = () => {
            this.bannerCache = new Map();
            this.getBoardRegistrationAndScale();
        };
        globalMap = this;
        this.previouslyReadStates = [null, null, null];
    }

    componentDidMount() {
        this.makeReferenceImageCanvases();
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
                console.log("Width:", this.width, this.height, this);
                newCanvas.width = this.width;
                newCanvas.height = this.height;
                const ctx = newCanvas.getContext('2d');
                ctx.drawImage(newImage, 0, 0);
            };
            this.referenceCanvases[name] = newCanvas;
        }
    }

    makeEmptyState() {
        const grid = [];
        const probs = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                grid[[x, y]] = null;
                probs[[x, y]] = 0.0;
            }
        }
        // Select a particular layout, for practice mode.
        const squidLayout = generateLayout();
        return {
            mode: 'calculator',
            squidLayout,
            grid,
            squidsGotten: 'unknown',
            probs,
            best: [3, 3],
            valid: true,
            observationProb: 1.0,
            screenRecordingActive: false,
            doVideoProcessing: false,
            lastComputationTime: -1,
            lastCVTime: -1,
            turboBlurboMode: false,

            potentialMatches: [],
            firstBoardStepsThousands: 100,
            firstBoardStepsThousandsStdDev: 100,
            nextBoardStepsThousands: 3,
            nextBoardStepsThousandsStdDev: 1,
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

    initializeTurboBlurboMode(bigTable) {
        if (this.state.turboBlurboMode !== false)
            return;
        this.setState({turboBlurboMode: 'initializing'});
        this.boardIndices = makeBoardIndicesTable();
        const req = new XMLHttpRequest();
        const tableName = bigTable ? '/board_table_25M.bin' : '/board_table_5M.bin';
        req.open('GET', process.env.PUBLIC_URL + tableName, true);
        req.responseType = 'arraybuffer';
        req.onload = (evt) => {
            this.boardTable = new Uint32Array(req.response);
            // Warning: Do I need to await wasm here first?
            console.log('Board table length:', this.boardTable.length);
            // Make sure every value is in range.
            for (const v of this.boardTable)
                if (v > 604583)
                    alert('BUG BUG BUG: Bad value in board table: ' + v);
            set_board_table(this.boardTable);
            this.setState({turboBlurboMode: true});
        };
        req.send();
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
                i == 0 ? 20 : (i == 1 ? 10 : 4),
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
                const cursorHaloLeft  = probablyInsideCursor || x === mostLikelyCursorLocation.x + 1 && y === mostLikelyCursorLocation.y;
                const cursorHaloRight = probablyInsideCursor || x === mostLikelyCursorLocation.x - 1 && y === mostLikelyCursorLocation.y;
                const cursorHaloUp    = probablyInsideCursor || x === mostLikelyCursorLocation.x && y === mostLikelyCursorLocation.y + 1;
                const cursorHaloDown  = probablyInsideCursor || x === mostLikelyCursorLocation.x && y === mostLikelyCursorLocation.y - 1;
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
        if (observedBoards.length === 0)
            yield [];
        // Try to find the first match.
        const soughtBoard = observedBoards[0];
        const boardTable = this.boardTable;
        const indexMax = Math.min(boardTable.length, startIndex + scanRange);
        for (let i = startIndex; i < indexMax; i++)
            if (boardTable[i] === soughtBoard)
                for (const subResult of this.findMatchingLocations(observedBoards.slice(1), i, 10000))
                    yield [i, ...subResult];
    }

    async doComputation(grid, squidsGotten) {
        const t0 = performance.now();
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
        let squids_gotten = -1;
        for (const n of ['0', '1', '2'])
            if (squidsGotten === n || squidsGotten === Number(n))
                squids_gotten = Number(n);

        await wasm;

        let probabilities;

        if (this.state.turboBlurboMode) {
            // Figure out how many history boards we have.
            const rawObservedBoards = this.layoutDrawingBoardRefs
                .map((ref) => this.boardIndices[ref.current.getLayoutString()]);
            const observedBoards = [];
            for (const ob of rawObservedBoards) {
                if (ob === undefined)
                    break;
                observedBoards.push(ob);
            }
            console.log('observedBoards:', observedBoards);

            const matches = [];
            for (const match of this.findMatchingLocations(observedBoards, 0, 1000000))
                matches.push(match);
            this.setState({potentialMatches: matches});

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
                    priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.nextBoardStepsThousands));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.nextBoardStepsThousandsStdDev));
                }
                first = false;
            }

            console.log('Turbo:', observedBoards, priorStepsFromPreviousMeans, priorStepsFromPreviousStdDevs);

            probabilities = calculate_probabilities_from_game_history(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                squids_gotten,
                Uint32Array.from(observedBoards),
                Uint32Array.from(priorStepsFromPreviousMeans),
                Float64Array.from(priorStepsFromPreviousStdDevs),
            );
        } else {
            probabilities = calculate_probabilities_with_board_constraints(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                squids_gotten,
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

            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    probs[[x, y]] = probabilities[8 * y + x];
                    if (grid[[x, y]] === null && probabilities[8 * y + x] > highestProb) {
                        highestProb = probabilities[8 * y + x];
                        maxX = x;
                        maxY = y;
                    }
                }
            }
            const observationProb = probabilities[64];
            this.setState({ probs, best: highestProb >= 0 ? [maxX, maxY] : null, valid: true, observationProb });
        }
        const t1 = performance.now();
        this.setState({lastComputationTime: t1 - t0});
    }

    onClick(x, y) {
        const grid = { ...this.state.grid };
        let gridValue = grid[[x, y]];
        let squidsGotten = this.state.squidsGotten;

        if (this.state.mode === 'calculator') {
            switch (gridValue) {
                case null:
                    gridValue = 'MISS';
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
        this.setState({ grid });
        this.doComputation(grid, squidsGotten);
    }

    clearField() {
        const templateState = this.makeEmptyState();
        const newState = {};
        for (const name of ['squidLayout', 'grid', 'squidsGotten'])
            newState[name] = templateState[name];
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
    }

    renderActualMap(overlayMode) {
        return <div style={{display: 'inline-block'}}>
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
        }}>
            <span style={{ fontSize: '150%', color: 'white' }}>Shots used: {usedShots}</span><br />
            {this.state.doVideoProcessing || this.renderActualMap(false)}
            {this.state.valid || <div style={{ fontSize: '150%', color: 'white' }}>Invalid configuration! This is not possible.</div>}
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
                    <option value="unknown">Unknown</option>
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
            <br />
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.clearField(); }}>Reset</button>
            <select
                style={{ marginLeft: '20px', fontSize: '150%' }}
                value={this.state.mode}
                onChange={(event) => this.setState({ mode: event.target.value })}
            >
                <option value="calculator">Calculator Mode</option>
                <option value="practice">Practice Mode</option>
            </select><br />
            {openingOptimizer && (!this.state.screenRecordingActive) && this.state.mode === 'calculator' && (!this.state.turboBlurboMode) && <>
                <div style={{ color: 'white', fontSize: '120%', marginTop: '20px' }}>
                    Opening optimizer: Probability that this<br />pattern would get at least one hit: {
                        this.state.valid ? ((100 * Math.max(0, 1 - this.state.observationProb)).toFixed(2) + '%') : "Invalid"
                    }
                </div>
            </>}
            {/* <button style={{ fontSize: '150%' }} onClick={() => { this.readBoardState(); }}>Do Computation</button><br /> */}
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
                    {/*
                    First board mean:   <NumericInput style={{width: '50px'}} value={this.state.firstBoardStepsThousands}       onInput={num => this.setState({firstBoardStepsThousands: num})}/> &nbsp;
                    First board stddev: <NumericInput style={{width: '50px'}} value={this.state.firstBoardStepsThousandsStdDev} onInput={num => this.setState({firstBoardStepsThousandsStdDev: num})}/> &nbsp;
                    Next board mean:    <NumericInput style={{width: '50px'}} value={this.state.nextBoardStepsThousands}        onInput={num => this.setState({nextBoardStepsThousands: num})}/> &nbsp;
                    Next board stddev:  <NumericInput style={{width: '50px'}} value={this.state.nextBoardStepsThousandsStdDev}  onInput={num => this.setState({nextBoardStepsThousandsStdDev: num})}/>
                    */}
                    Gaussian RNG step count beliefs (all counts in <i>thousands</i> of steps):<br/>
                    First board mean:   <input style={{width: '50px'}} value={this.state.firstBoardStepsThousands}       onInput={event => this.setState({firstBoardStepsThousands: event.target.value})}/> &nbsp;
                    First board stddev: <input style={{width: '50px'}} value={this.state.firstBoardStepsThousandsStdDev} onInput={event => this.setState({firstBoardStepsThousandsStdDev: event.target.value})}/> &nbsp;
                    Next board mean:    <input style={{width: '50px'}} value={this.state.nextBoardStepsThousands}        onInput={event => this.setState({nextBoardStepsThousands: event.target.value})}/> &nbsp;
                    Next board stddev:  <input style={{width: '50px'}} value={this.state.nextBoardStepsThousandsStdDev}  onInput={event => this.setState({nextBoardStepsThousandsStdDev: event.target.value})}/>
                </div>
                <div style={{margin: '20px', color: 'white', fontSize: '130%', border: '1px solid white', width: '400px', minHeight: '20px', display: 'inline-block'}}>
                    {this.state.potentialMatches.map((m, i) => <div key={i}>
                        Potential match:{m.map((x, i) => <span key={i}> {x}</span>)}
                    </div>)}
                </div>
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
            <span style={{ color: 'white' }}>Made by Peter Schmidt-Nielsen and CryZe (v0.0.4)</span>
        </div>;
    }
}

export default App;
