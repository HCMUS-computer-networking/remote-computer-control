class FrameEventBus extends EventTarget {
    constructor() {
        super();
    }

    // Tên sự kiện (event name) được cấu thành từ agent_id và module
    // VD: "frame_agent123_screen"
    _getEventName(agentId, module) {
        return `frame_${agentId}_${module}`;
    }

    emit(agentId, module, frameBuffer, frameMeta) {
        const eventName = this._getEventName(agentId, module);
        const event = new CustomEvent(eventName, {
            detail: {
                frame_buffer: frameBuffer,
                frame_meta: frameMeta
            }
        });
        this.dispatchEvent(event);
    }

    on(agentId, module, callback) {
        const eventName = this._getEventName(agentId, module);
        const listener = (e) => callback(e.detail.frame_buffer, e.detail.frame_meta);
        this.addEventListener(eventName, listener);
        // Trả về hàm cleanup chính nó để dễ dàng unsubscribe trong useEffect
        return () => this.removeEventListener(eventName, listener);
    }
}

const frameEventBus = new FrameEventBus();
export default frameEventBus;
