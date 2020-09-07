// 设置canvas背景支持alpha通道（视频是使用的原生video组件，层级在canvas之下）
cc.macro.ENABLE_TRANSPARENT_CANVAS = true;
const AUDIO_STATE_READY = 0;
const AUDIO_STATE_RECORDING = 1;
const AUDIO_STATE_TBJ = 2;
const AUDIO_STATE_JINGSHEN = 3;
const AUDIO_STATE_WAITING = 4;


cc.Class({
    extends: cc.Component,

    properties: {
        videoPlayer: {
            type: cc.VideoPlayer,
            default: null,
        },
        dialog: {
            type: cc.Node,
            default: null
        },
        menu: {
            type: cc.Node,
            default: null
        },
        stateScript: {
            type: cc.JsonAsset,
            default: null,
        },
        bgmClip: {
            type: cc.AudioClip,
            default: null,
        },
        startClip: {
            type: cc.AudioClip,
            default: null
        },
        windowSize: { // 间隔多少秒(不一定严格)，开始检测
            type: cc.Float,
            default: 0.5
        },
        environmentLevel: { // 幅度小于这个值认为是环境音量
            type: cc.Float,
            default: 0.1
        },
        jingshenLevel: { // 幅度小于这个值认为听不见
            type: cc.Float,
            default: 0.7
        }
    },

    // functions 
    _innerStateNext(ns) {
        // 跳到下一个状态
        this.state = ns || this.state && this.stateList[this.state].next;
        // 直接停止bgm
        cc.audioEngine.stop(this.bgm);
        if (this.state) {
            const nextState = this.stateList[this.state];
            this.dialog.getChildByName('arrow').active = true;
            // 特殊状态
            if (this.state === 'wait-for-input') {
                nextState.role = this.username;
                this._innerStartRecording();
                this.dialog.getChildByName('arrow').active = false;
            }

            // 修改台词
            this.dialog.getChildByName('role').getComponent(cc.Label).string = nextState.role + ':';
            this.dialog.getChildByName('role-script').getComponent(cc.Label).string = nextState.script;
            // 播放视频
            this.videoPlayer.clip = this.videoAssets[nextState.video];
            this.videoPlayer.play();
            // 是否循环播放
            if (nextState.loop) {
                console.log('loop');
                this.videoPlayer.node.on('completed', () => {
                    this.videoPlayer.play();
                }, this);
            } else {
                this.videoPlayer.node.off('completed');
            }


        }

    },

    onSetLevel(e){
        switch(e.target.name){
            case 'toggle easy': 
                this.jingshenLevel = 0.3;
                break;
            case 'toggle middle':
                this.jingshenLevel = 0.5;
                break;
            case 'toggle hard':
                this.jingshenLevel = 0.7;
                break;
        }
    },

    _innerStartRecording() {
        navigator.mediaDevices.getUserMedia({
            audio: true
        }).then((stream) => {
            this.audioState = AUDIO_STATE_READY;
            this.audioStream = stream;
            const context = new AudioContext();
            const src = context.createMediaStreamSource(stream);
            this.analyser = context.createAnalyser();
            src.connect(this.analyser);
            this.analyser.fftSize = 1024;
            // 录音的时域数据
            this.audioData = new Float32Array(this.analyser.frequencyBinCount);
        });
    },

    _avg(arr) {
        return arr.reduce((prev, curr) => prev + curr, 0) / arr.length;
    },

    _checkState(amplitude) {
        this.slideWindow.shift();
        this.slideWindow.push(amplitude);


        const avg = this._avg(this.slideWindow);
        const currState = this.audioState;
        if (currState === AUDIO_STATE_READY) {
            // 就绪状态下，检测到高于环境音量，则开始录音
            if (avg > this.environmentLevel) {
                this.audioWindow = [...this.slideWindow];
                this.audioState = AUDIO_STATE_RECORDING;
                return;
            }

        }

        //录音状态下，如果4秒内的语音没有劲儿，就重来(按60fps算)
        if (currState === AUDIO_STATE_RECORDING) {
            this.audioWindow.push(amplitude);
            if (this.audioWindow.length > 4 * 60) {
                console.log('4s');
                // 是否有劲?
                if (this._avg(this.audioWindow) < this.jingshenLevel) {
                    // 根本听不见
                    this.audioState = AUDIO_STATE_TBJ;
                }
                this.audioWindow.shift();

            }

            // 是否停止
            if (avg < this.environmentLevel) {
                // 根本听不见
                // console.log('???val', this._avg(this.audioWindow.filter(val => val > this.environmentLevel)));
                // 如果不够4秒，并且没劲
                if (this.audioWindow.length < 4 * 60) {
                    if (this._avg(this.audioWindow.filter(val => val > this.environmentLevel)) < this.jingshenLevel) {
                        this.audioState = AUDIO_STATE_TBJ;
                        return;
                    }
                }
                // 好，很有精神!
                this.audioState = AUDIO_STATE_JINGSHEN;
            }
        }

        if (currState === AUDIO_STATE_TBJ) {
            // 随机进入一个聋子状态
            this._innerStateNext(`tingbujian-${Math.floor(Math.random() * 3)}`);
            // 停止录音
            if (this.audioStream) {
                const track = this.audioStream.getTracks()[0];
                track.stop();
            }
            this.audioState = AUDIO_STATE_WAITING;
        }

        if (currState === AUDIO_STATE_JINGSHEN) {
            this._innerStateNext('jingshen');
            // 停止录音
            if (this.audioStream) {
                const track = this.audioStream.getTracks()[0];
                track.stop();
            }
            this.audioState = AUDIO_STATE_WAITING;
        }

    },

    // handler functions
    onDialogClick() {
        this._innerStateNext();
    },

    onMenuStartClick() {
        this.username = this.menu.getChildByName('input_name').getComponent(cc.EditBox).textLabel.getComponent(cc.Label).string || '你';
        cc.audioEngine.playEffect(this.startClip, false);
        this.dialog.active = true;
        this.menu.active = false;
        this._innerStateNext();
    },

    // LIFE-CYCLE CALLBACKS:

    onLoad() {
        // 总体流程状态
        this.state = 'ready';
        // 音频analyser
        this.analyser = null;
        // 音频流
        this.audioStream = null;
        // 音频时域数据
        this.audioData = null;
        // 录音状态
        this.audioState = AUDIO_STATE_READY; // ready, recoding, judging
        // 滑动窗口
        this.slideWindow = new Array(Math.floor(this.windowSize * 60)).fill(0);
        // 录音窗口
        this.audioWindow = [];
        // 加载json
        this.stateList = this.stateScript.json;
        // 加载视频bundle
        cc.resources.loadDir('videos', cc.Asset, (err, assets) => {
            if (err) {
                return;
            }
            this.videoAssets = {};
            assets.forEach(asset => {
                this.videoAssets[asset.name] = asset;
            })
        })

        // 加载bgm
        this.bgm = cc.audioEngine.playMusic(this.bgmClip, true);
        // 随机设置tips
        this.menu.getChildByName('tips').getComponent(cc.Label).string = 'tips: ' + ['我们遇到什么困难，也不要怕，微笑着面对它。消除恐惧的最好办法就是面对恐惧，坚持，才是胜利！加油，奥利给！', '你吼那么大声干什么嘛', '十七张牌，你能秒我？', '玩游戏一定要笑着玩', '这么小声还想开军舰？' ][Math.floor(Math.random() * 5)];

    },

    start() {
        // 事件
        this.dialog.on(cc.Node.EventType.MOUSE_DOWN, this.onDialogClick, this);
    },

    update(dt) {
        if (this.analyser) {
            this.analyser.getFloatTimeDomainData(this.audioData);
            // 当前帧的峰值
            const amplitude = Math.max(...this.audioData); // 0-1区间
            this._checkState(amplitude);
        }
    },
});
