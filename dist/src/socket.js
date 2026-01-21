"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIO = exports.setIO = void 0;
let io = null;
const setIO = (instance) => {
    io = instance;
};
exports.setIO = setIO;
const getIO = () => {
    return io;
};
exports.getIO = getIO;
