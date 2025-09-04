import React from 'react';

const LogTerminal = ({ logs }) => {
    const getLogLevelClass = (level) => {
        switch (level) {
            case 'success': return 'log-success';
            case 'error': return 'log-error';
            case 'warning': return 'log-warning';
            default: return 'log-info';
        }
    };

    return (
        <div className="log-terminal">
            <div className="log-terminal-header">
                <span>EVENT LOG</span>
            </div>
            <div className="log-terminal-body">
                {logs.slice(-7).map((log, index) => (
                    <div key={index} className={`log-entry ${getLogLevelClass(log.level)}`}>
                        <span className="log-timestamp">{log.timestamp}</span>
                        <span className="log-message">{log.message}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default LogTerminal;