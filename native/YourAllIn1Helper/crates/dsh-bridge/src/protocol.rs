//! Length-prefixed JSON frames for bridge protocol v1.

use serde::Deserialize;
use serde_json::{Map, Value};

pub const PROTOCOL_VERSION: u64 = 1;
pub const MAX_FRAME_LEN: usize = 4_194_304;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolFault {
    EmptyFrame,
    OversizeFrame,
    BadUtf8,
    BadJson,
    VersionMismatch,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClientMessage {
    Hello { instance_id: String },
    Request { id: String, method: String, params: Value },
    Cancel { id: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Incoming {
    #[serde(rename = "hello")]
    Hello {
        v: u64,
        #[serde(rename = "instanceId")]
        instance_id: String,
    },
    #[serde(rename = "request")]
    Request {
        v: u64,
        id: String,
        method: String,
        params: Map<String, Value>,
    },
    #[serde(rename = "cancel")]
    Cancel { v: u64, id: String },
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
}

impl FrameDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, ProtocolFault> {
        // Callers read at most 64 KiB at a time, and a declared length above the
        // maximum is rejected before its body is accumulated.
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            if self.buf.len() < 4 {
                break;
            }
            let len = u32::from_le_bytes(self.buf[0..4].try_into().expect("4 bytes")) as usize;
            if len == 0 {
                return Err(ProtocolFault::EmptyFrame);
            }
            if len > MAX_FRAME_LEN {
                return Err(ProtocolFault::OversizeFrame);
            }
            if self.buf.len() < 4 + len {
                break;
            }
            let frame = self.buf[4..4 + len].to_vec();
            self.buf.drain(..4 + len);
            frames.push(frame);
        }
        Ok(frames)
    }
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, ProtocolFault> {
    if payload.is_empty() {
        return Err(ProtocolFault::EmptyFrame);
    }
    if payload.len() > MAX_FRAME_LEN {
        return Err(ProtocolFault::OversizeFrame);
    }
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn parse_message(frame: &[u8]) -> Result<ClientMessage, ProtocolFault> {
    let text = std::str::from_utf8(frame).map_err(|_| ProtocolFault::BadUtf8)?;
    let incoming: Incoming = serde_json::from_str(text).map_err(|_| ProtocolFault::BadJson)?;
    match incoming {
        Incoming::Hello { v, instance_id } => {
            check_version(v)?;
            Ok(ClientMessage::Hello { instance_id })
        }
        Incoming::Request {
            v,
            id,
            method,
            params,
        } => {
            check_version(v)?;
            Ok(ClientMessage::Request {
                id,
                method,
                params: Value::Object(params),
            })
        }
        Incoming::Cancel { v, id } => {
            check_version(v)?;
            Ok(ClientMessage::Cancel { id })
        }
    }
}

fn check_version(version: u64) -> Result<(), ProtocolFault> {
    if version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(ProtocolFault::VersionMismatch)
    }
}

pub fn expected_pipe_name(instance_id: &str) -> String {
    format!(r"\\.\pipe\dsh-toolbox-{instance_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(text: &str) -> Vec<u8> {
        encode_frame(text.as_bytes()).unwrap()
    }

    #[test]
    fn partial_then_coalesced_frames_round_trip() {
        let first = payload(r#"{"v":1,"type":"hello","instanceId":"abc"}"#);
        let second = payload(r#"{"v":1,"type":"cancel","id":"r1"}"#);
        let mut decoder = FrameDecoder::default();
        assert!(decoder.push(&first[..2]).unwrap().is_empty());
        let mut both = first[2..].to_vec();
        both.extend_from_slice(&second);
        let frames = decoder.push(&both).unwrap();
        assert_eq!(frames.len(), 2);
        assert!(matches!(
            parse_message(&frames[0]).unwrap(),
            ClientMessage::Hello { .. }
        ));
        assert!(matches!(
            parse_message(&frames[1]).unwrap(),
            ClientMessage::Cancel { .. }
        ));
        assert!(decoder.push(&[]).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_oversize_bad_utf8_bad_json_and_version() {
        let mut decoder = FrameDecoder::default();
        assert_eq!(
            decoder.push(&0u32.to_le_bytes()).unwrap_err(),
            ProtocolFault::EmptyFrame
        );
        decoder = FrameDecoder::default();
        let too_big = ((MAX_FRAME_LEN as u32) + 1).to_le_bytes();
        assert_eq!(
            decoder.push(&too_big).unwrap_err(),
            ProtocolFault::OversizeFrame
        );
        let bad_utf8 = encode_frame(&[0xff, 0xfe]).unwrap();
        let frame = FrameDecoder::default().push(&bad_utf8).unwrap();
        assert_eq!(parse_message(&frame[0]).unwrap_err(), ProtocolFault::BadUtf8);
        let bad_json = payload("{");
        let frame = FrameDecoder::default().push(&bad_json).unwrap();
        assert_eq!(parse_message(&frame[0]).unwrap_err(), ProtocolFault::BadJson);
        let wrong_version = payload(r#"{"v":2,"type":"hello","instanceId":"abc"}"#);
        let frame = FrameDecoder::default().push(&wrong_version).unwrap();
        assert_eq!(
            parse_message(&frame[0]).unwrap_err(),
            ProtocolFault::VersionMismatch
        );
    }
}
