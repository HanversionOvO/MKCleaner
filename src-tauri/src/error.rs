use serde::Serialize;

/// Anything that can go wrong while driving the Mole engine.
///
/// Serializes to a plain string so the frontend gets a readable message instead
/// of a tagged enum it would have to pattern-match.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("cleanup engine not found at {0}")]
    EngineMissing(String),

    #[error("cleanup engine is not executable and could not be fixed: {0}")]
    EngineNotExecutable(String),

    #[error("`mole {args}` failed with {status}: {stderr}")]
    Command {
        args: String,
        status: String,
        stderr: String,
    },

    #[error("could not read `mole {args}` output as JSON: {source}")]
    Json {
        args: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("{context}: {source}")]
    Io {
        context: String,
        #[source]
        source: std::io::Error,
    },

    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn io(context: impl Into<String>, source: std::io::Error) -> Self {
        Error::Io {
            context: context.into(),
            source,
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
