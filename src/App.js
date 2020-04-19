import React from 'react';
import './App.css';
import init, { calculate_probabilities } from './wasm/sploosh_wasm.js';
const interpolate = require('color-interpolate');
//const opencv = require('opencv.js');

//const colormap = interpolate(['#004', '#090', '#0a0', 'green']);
const colormap = interpolate(['#004', '#0a0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] == this.props.x && this.props.best[1] == this.props.y;

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
                backgroundColor: this.props.text === null ? colormap(this.props.prob) : (
                    this.props.text === 'HIT' ? '#a2a' : '#44a'
                ),
            }}
            onClick={this.props.onClick}
        >
            {this.props.text === null ? (this.props.prob * 100).toFixed(2) + '%' : this.props.text}
        </div>;
    }
}

let wasm = init(process.env.PUBLIC_URL + "/sploosh_wasm_bg.wasm");

class MainMap extends React.Component {
    videoRef = React.createRef();
    canvasRef = React.createRef();
    //referenceCanvasRef = React.createRef();
    outputCanvasRef = React.createRef();
    hiddenAreaRef = React.createRef();

    constructor() {
        super();
        this.state = this.makeEmptyState();
        this.bannerCache = new Map();
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    componentDidMount() {
        this.makeReferenceImageCanvases();
        setTimeout(() => this.getScreenRecording(), 1000);
    }

    makeReferenceImageCanvases() {
        const hiddenArea = this.hiddenAreaRef.current;
        this.referenceCanvases = {};
        for (const name of ['hit', 'miss', 'killed_squid', 'remaining_squid', 'top_banner']) {
            //
            /*
            var c = document.getElementById("myCanvas");
            var ctx = c.getContext("2d");
            var img = document.getElementById("scream");
            ctx.drawImage(img, 10, 10);
            */
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
            // <img src={process.env.PUBLIC_URL + '/images/hit.png'}></img>
            //this.imageTags.push(newImageTag);
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
        return { grid, squidsGotten: 'unknown', probs, best: [3, 3], valid: true, observationProb: 1.0 };
    }

    async getScreenRecording() {
        const displayMediaOptions = {
            video: {
              cursor: "always",
            },
            audio: false,
        };
        const captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        const video = this.videoRef.current;
        const canvas = this.canvasRef.current;
        //console.log(video, canvas);
        video.srcObject = captureStream;
        video.play();
        setTimeout(
            () => this.getBoardRegistrationAndScale(),
            1000,
        );
        
        //setInterval(() => this.updateCapture(), 500);
    }

    async getBoardRegistrationAndScale() {
        // Scan our matched filter for the top banner at a variety of scales.
        this.updateCapture();
        /*
        // Do a quick grid search to get the interval to zoom in on.
        const scalesToTest = [];
        for (let scale = 0.1; scale < 1; scale += 0.005)
            scalesToTest.push(scale);
        const scores = [];
        for (const scale of scalesToTest)
            scores.push(this.testForTopBannerAtScale(scale));
        console.log('' + scores);
        */
        let bestGuessScale = 0.5; //0.5;
        let searchMargin = 0.5;
        for (let i = 0; i < 7; i++) {
            this.boardFitParams = await this.performGridSearch(
                bestGuessScale * (1 - searchMargin),
                bestGuessScale * (1 + 2 * searchMargin),
                10,
            );
            bestGuessScale = this.boardFitParams.scale;
            searchMargin /= 2;
        }
        console.log('Best fit params:', this.boardFitParams);
        // Force a rerender.
        this.bannerCache.delete(bestGuessScale);
        this.testForTopBannerAtScale(bestGuessScale);
        await new Promise(resolve => setTimeout(resolve, 100));
        setInterval(
            () => this.readBoardState(),
            250,
        )
        //this.readBoardState();
        /*
        const bestCoarseScale = await this.performGridSearch(0.1, 1, 10);
        const bestIntermediateScale = await this.performGridSearch(
            bestCoarseScale * 0.5,
            bestCoarseScale * 2,
            10,
        );
        */
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

    testForTopBannerAtScale(scale) {
        if (this.bannerCache.has(scale)) {
            return this.bannerCache.get(scale);
        }
        // OpenCV code.
        const src = window.cv.imread('cv_canvasRef');
        //const templ = window.cv.imread('cv_referenceCanvasRef');
        const base_templ = window.cv.imread('canvas_top_banner'); //this.referenceCanvases['miss'];
        // TODO: Don't hardcode these sizes.
        const scaled_banner_width = Math.round(494 * scale);
        const scaled_banner_height = Math.round(129 * scale);
        let templ = new window.cv.Mat();
        let dsize = new window.cv.Size(scaled_banner_width, scaled_banner_height);
        // You can try more different parameters
        window.cv.resize(base_templ, templ, dsize, 0, 0, window.cv.INTER_AREA);

        const dst = new window.cv.Mat();
        const mask = new window.cv.Mat();
        //const matchMode = window.cv.TM_CCOEFF_NORMED;
        const matchMode = window.cv.TM_CCOEFF;
        window.cv.matchTemplate(src, templ, dst, matchMode, mask);
        let result = window.cv.minMaxLoc(dst, mask);
        let maxPoint = result.maxLoc;
        let color = new window.cv.Scalar(255, 0, 0, 255);
        let point = new window.cv.Point(maxPoint.x + templ.cols, maxPoint.y + templ.rows);
        window.cv.rectangle(src, maxPoint, point, color, 2, window.cv.LINE_8, 0);
        // Draw each of the little squares.
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                let centerX = Math.round(maxPoint.x + scale * (105 + x * 52.5));
                let centerY = Math.round(maxPoint.y + scale * (155 + y * 52.5));
                let tl = new window.cv.Point(centerX - 9, centerY - 9);
                let br = new window.cv.Point(centerX + 9, centerY + 9);
                window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);
            }
        }
        for (let squidIndex = 0; squidIndex < 3; squidIndex++) {
            let centerX = Math.round(maxPoint.x + scale * 648);
            let centerY = Math.round(maxPoint.y + scale * (122 + squidIndex * 89));
            let tl = new window.cv.Point(centerX - 15, centerY - 15);
            let br = new window.cv.Point(centerX + 15, centerY + 15);
            window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);
        }
        window.cv.imshow('cv_outputCanvasRef', src);
        src.delete(); base_templ.delete(); templ.delete(); dst.delete(); mask.delete();
        //console.log(result);
        // Because the value that OpenCV returns is (I think) the raw convolution result from the matched filter
        // the scores basically scale with the image size. Therefore, to normalize we scale inversely by scale^2.
        // The 1e-6 is just to make the numbers be a bit closer to 1.
        let score = result.maxVal * 1e-6; // / (scale * scale);
        score /= scale * scale;
        this.bannerCache.set(scale, score);
        return {
            score, scale,
            offset: {x: maxPoint.x, y: maxPoint.y},
        };
    }

    readBoardState() {
        this.updateCapture();
        const t0 = performance.now();
        const offsetX = this.boardFitParams.offset.x;
        const offsetY = this.boardFitParams.offset.y;
        const scale   = this.boardFitParams.scale;

        const src = window.cv.imread('cv_canvasRef');
        const toDelete = [src];
        const nameToHeatmap = {};
        const nameToScoreScaling = {};
        for (const name of ['hit', 'miss', 'remaining_squid', 'killed_squid']) {
            const base_templ = window.cv.imread('canvas_' + name);
            //console.log('Base template:', name, base_templ);
            const scaledWidth = Math.round(base_templ.size().width * scale);
            const scaledHeight = Math.round(base_templ.size().height * scale);
            //console.log('Sizes:', scaledWidth, scaledHeight);
            let templ = new window.cv.Mat();
            let dsize = new window.cv.Size(scaledWidth, scaledHeight);
            window.cv.resize(base_templ, templ, dsize, 0, 0, window.cv.INTER_AREA);

            const dst = new window.cv.Mat();
            const mask = new window.cv.Mat();
            window.cv.matchTemplate(src, templ, dst, window.cv.TM_CCOEFF_NORMED, mask);
            //window.cv.matchTemplate(src, templ, dst, window.cv.TM_SQDIFF_NORMED, mask);
            //window.cv.matchTemplate(src, templ, dst, window.cv.TM_CCORR_NORMED, mask);

            const ksize = new window.cv.Size(5, 5);
            window.cv.GaussianBlur(dst, dst, ksize, 0, 0, window.cv.BORDER_DEFAULT);

            nameToHeatmap[name] = dst;
            nameToScoreScaling[name] = 1; //1 / (scaledWidth * scaledHeight);

            toDelete.push(base_templ, templ, dst, mask);
        }

        const sampleFrom = (name, x, y) => {
            const img = nameToHeatmap[name];
            // Because our convolution makes images slight smaller due to borders, we have to correct for that here.
            const sampleOffsetX = Math.round((src.size().width - img.size().width) / 2);
            const sampleOffsetY = Math.round((src.size().height - img.size().height) / 2);
            // Note that OpenCV defaults to (row, col), that is to say (y, x) for this routine.
            return img.floatAt(y - sampleOffsetY, x - sampleOffsetX);
        };

        // Extract the info.
        let nothingColor        = new window.cv.Scalar(80,  80,  80,  255);
        let hitColor            = new window.cv.Scalar(255, 0,   255, 255);
        let missColor           = new window.cv.Scalar(100, 255, 0,   255);
        let killedSquidColor    = new window.cv.Scalar(255, 100, 100, 255);
        let remainingSquidColor = new window.cv.Scalar(50,  255, 100, 255);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                let centerX = offsetX + scale * (105 + x * 52.5);
                let centerY = offsetY + scale * (155 + y * 52.5);
                
                //const sampleOffsetX = src.size().width - 
                //const hitScore  = -nameToHeatmap.hit.floatAt(centerY, centerX) * nameToScoreScaling.hit;
                //const missScore = -nameToHeatmap.miss.floatAt(centerY, centerX) * nameToScoreScaling.miss;
                const hitScore = sampleFrom('hit', centerX, centerY);
                const missScore = sampleFrom('miss', centerX, centerY);
                //console.log('Scores:', x, y, hitScore, missScore);
                let color = nothingColor;
                if (hitScore > 0.5 || missScore > 0.3) {
                    color = hitScore > missScore ? hitColor : missColor;
                }
                /*
                if (hitScore > 1000 || missScore > 100) {
                    color = hitScore > missScore * 5 ? hitColor : missColor;
                }
                */
                //if (hitScore)
                let tl = new window.cv.Point(centerX - 9, centerY - 9);
                let br = new window.cv.Point(centerX + 9, centerY + 9);
                window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);

                /*
                const sampleOffsetX = Math.round((src.size().width - nameToHeatmap.miss.size().width) / 2);
                const sampleOffsetY = Math.round((src.size().height - nameToHeatmap.miss.size().height) / 2);
                tl = new window.cv.Point(centerX - 2 - sampleOffsetX, centerY - 2 - sampleOffsetY);
                br = new window.cv.Point(centerX + 2 - sampleOffsetX, centerY + 2 - sampleOffsetY);
                window.cv.rectangle(nameToHeatmap.miss, tl, br, color, 1, window.cv.LINE_8, 0);
                */
            }
        }
        for (let squidIndex = 0; squidIndex < 3; squidIndex++) {
            let centerX = Math.round(offsetX + scale * 648);
            let centerY = Math.round(offsetY + scale * (122 + squidIndex * 89));
            //const killedScore    = -nameToHeatmap.killed_squid.floatAt(centerY, centerX) * nameToScoreScaling.killed_squid;
            //const remainingScore = -nameToHeatmap.remaining_squid.floatAt(centerY, centerX) * nameToScoreScaling.remaining_squid;
            const killedScore = sampleFrom('killed_squid', centerX, centerY);
            const remainingScore = sampleFrom('remaining_squid', centerX, centerY);
            let tl = new window.cv.Point(centerX - 15, centerY - 15);
            let br = new window.cv.Point(centerX + 15, centerY + 15);
            let color = nothingColor;
            if (killedScore > remainingScore)
                color = killedSquidColor;
            window.cv.rectangle(src, tl, br, color, 1, window.cv.LINE_8, 0);
        }
        window.cv.imshow('cv_outputCanvasRef', src);
        //nameToHeatmap.hit.convertTo(nameToHeatmap.hit, -1, 2e-7, 0);
        //window.cv.imshow('cv_outputCanvasRef', nameToHeatmap.hit);
        //nameToHeatmap.miss.convertTo(nameToHeatmap.miss, -1, 2e-7, 0);
        //nameToHeatmap.miss.convertTo(nameToHeatmap.miss, -1, 0.25, 0); // CCORR_NORMED
        //window.cv.imshow('cv_outputCanvasRef', nameToHeatmap.miss);

        for (const mat of toDelete)
            mat.delete();
        const t1 = performance.now();
        console.log('Took: ' + (t1 - t0) + 'ms');
    }

    updateCapture() {
        const video = this.videoRef.current;
        const canvas = this.canvasRef.current;
        //const referenceCanvas = this.referenceCanvasRef.current;
        //const outputCanvas = this.outputCanvasRef.current;
        const context = canvas.getContext('2d');
        //const width = video.width;
        //const height = video.height;
        const width = 640;
        const height = Math.round(width * (video.videoHeight / video.videoWidth));
        console.log('Native image capture shape: ' + video.videoWidth + 'x' + video.videoHeight + ' -> scaling to: ' + width + 'x' + height);
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
    }

    /*
    {
        //var data = canvas.toDataURL('image/png');
        //photo.setAttribute('src', data);
    }
    */

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
            if (squidsGotten === n)
                squids_gotten = Number(n);

        await wasm;
        const probabilities = calculate_probabilities(Uint8Array.from(hits), Uint8Array.from(misses), squids_gotten);
        console.debug(probabilities);

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
    }

    onClick(x, y) {
        const grid = { ...this.state.grid };
        let gridValue = grid[[x, y]];
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
        this.setState({ grid });
        this.doComputation(grid, this.state.squidsGotten);
    }

    clearField() {
        const newState = this.makeEmptyState();
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
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
                        />
                    )}
                </div>
            )}
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
                </select>
                <br />
                {/*
                <span style={{color: 'white', fontSize: '80%'}}>
                    Probability of this pattern yielding these results: {(100 * this.state.observationProb).toFixed(2) + '%'}
                </span>
                */}
            </div>
            <br />
            <button style={{ fontSize: '150%' }} onClick={() => { this.clearField(); }}>Reset</button><br />
            {openingOptimizer && <>
                <div style={{ color: 'white', fontSize: '120%', marginTop: '20px' }}>
                    Opening optimizer: Probability that this<br />pattern would get at least one hit: {
                        this.state.valid ? ((100 * Math.max(0, 1 - this.state.observationProb)).toFixed(2) + '%') : "Invalid"
                    }
                </div>
            </>}

            <video style={{display: 'none'}} ref={this.videoRef}>Video stream not available.</video>
            <canvas ref={this.canvasRef} id="cv_canvasRef"></canvas>
            {/* <canvas ref={this.referenceCanvasRef} id="cv_referenceCanvasRef"></canvas> */}
            <canvas ref={this.outputCanvas} id="cv_outputCanvasRef"></canvas>
            <div style={{display: 'none'}} ref={this.hiddenAreaRef}></div>
        </div>;
    }
}

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
            <div style={{ display: 'inline-block' }}>
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
                <span style={{ color: 'white' }}>Made by Peter Schmidt-Nielsen and CryZe</span>
            </div>
        </div>;
    }
}

export default App;
