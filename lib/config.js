const config = {
    pollingIntervalMillis: 5 * 1000, 
    mindolife: {
        developerKey: 'your_key',
        sessionKey: 'your_key',
        gatewayId: '1234'
    },
    mqtt: {
        host: '10.0.0.107',
        port: 1883,
        username: 'DVES_USER',
        password: 'DVES_PASS',
        topicPrefix: 'homeassistant'
    },
    log: true
};

module.exports = config;
