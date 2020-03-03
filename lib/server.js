/**
 * Created by or on 03/06/2017.
 */
const express = require('express')
const request = require('request')
const config = require('./config')
const mqtt = require('mqtt')
const { parseTopicsFromDevice, powerTopicSuffix, powerCommandTopicSuffix, stateTopicSuffix, bitwiseTurnPowerOnOrOffByState } = require('./mindoMQTT')
const { v4 } = require('uuid')

const UPDATE_INTERVAL = config.pollingInterval
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const log = function (message) {
  if (!config.log) { return }
  console.log(message)
}
const makeRequest = function (url, requestContent, cb) {
  const baseRequestParams = `developerKey=${config.mindolife.developerKey}` +
        `&sessionKey=${config.mindolife.sessionKey}` +
        `&gatewayId=${config.mindolife.gatewayId}` +
        '&dataType=jsonNew' +
        `&reqID=${v4()}`
  request({
    url: url,
    method: 'POST',
    agentOptions: {
      rejectUnauthorized: false
    },
    headers: {
      'content-type': 'application/x-www-form-urlencoded', // <--Very important!!!
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G900F Build/MMB29M)' // Mock actual device
    },
    body: baseRequestParams + ((!!requestContent && requestContent !== '') ? `&${requestContent}` : '')
  }, function (error, response, body) {
    cb(error, body)
  })
}

const getDevicesStateFromServer = function (callback) {
  lastUpdate = Date.now()
  makeRequest('https://webapp.mindolife.com/API/Gateway/getDeviceUnites', undefined, callback)
}

const handleGetDevicesState = function (res) {
  // check if cached
  if (lastUpdate + UPDATE_INTERVAL > Date.now()) {
    res.send(JSON.stringify(deviceStatesByTopic))
    log('Answered with cache')
  }
}

const updateDeviceState = function (deviceId, bitwiseState) {
  const requestContent = `id=${deviceId}&state=${bitwiseState}`
  makeRequest('https://webapp.mindolife.com/API/Gateway/changeControlState',
    requestContent,
    function (error, response, body) {
      if (error) {
        log(`Got error while updating:  ${error}`)
      }
    }
  )
}

const deviceStatesByTopic = {}
let lastUpdate = Date.now()

const publishStates = function (client, statesToPublish) {
  for (const key of Object.keys(statesToPublish)) {
    const value = statesToPublish[key]
    if (!!value && typeof (value) === 'string') {
      client.publish(key, Buffer.from(value, 'utf8'))
    }
  }
}

const devicesArrayFromBody = function (body) {
  const devicesJSON = JSON.parse(body)
  return devicesJSON.DevicesContainerUnits.DevicesContainerUnit
}

const bootstrapDevices = function (client) {
  const newState = {}
  getDevicesStateFromServer(function (err, body) {
    if (err) {
      log('Error: ' + err)
    }
    try {
      console.log('Got devices for the first time')
      const devicesArray = devicesArrayFromBody(body)
      if (!devicesArray) {
        log(`No devices were found in JSON: ${JSON.stringify(devicesArray)}`)
        return
      }

      for (const device of devicesArray) {
        // log(parseTopicsFromDevice(config.mqtt.topicPrefix, devicesArray[device]));
        const currentDevicePowerAndState = parseTopicsFromDevice(config.mqtt.topicPrefix, device)
        Object.assign(newState, currentDevicePowerAndState)
      }

      Object.assign(deviceStatesByTopic, newState)
      publishStates(client, newState)
      for (const topic of Object.keys(newState)) {
        const topicToSubscribeTo = topic.replace(powerTopicSuffix, powerCommandTopicSuffix);
        client.subscribe(topicToSubscribeTo, function (err) {
          if (!err) {
            log(`Succseefully subscribed to topic ${topicToSubscribeTo}`)
          }
        })
      }
    } catch (e) {
      log(`Got exception when bootstrapng devices: ${e.stack}`)
    }
  })
}

const pollAndUpdate = function (client) {
  const currentStates = {}
  getDevicesStateFromServer(function (err, body) {
    if (err) {
      log('Error: ' + err)
    }
    try {
      // console.log("Got current devices state from server");
      const devicesArray = devicesArrayFromBody(body)
      if (!devicesArray) {
        log(`No devices were found in JSON: ${JSON.stringify(devicesArray)}`)
        return
      }

      for (const device of devicesArray) {
        // log(parseTopicsFromDevice(config.mqtt.topicPrefix, devicesArray[device]));
        const currentDevicePowerAndState = parseTopicsFromDevice(config.mqtt.topicPrefix, device)
        Object.assign(currentStates, currentDevicePowerAndState)
      }

      const updatedStates = {}

      for (const key of Object.keys(currentStates)) {
        if (currentStates[key] !== deviceStatesByTopic[key]) {
          updatedStates[key] = currentStates[key]
        }
      }

      // log(`Publishing updated: ${JSON.stringify(updatedStates)}`);
      publishStates(client, updatedStates)
    } catch (e) {
      log(`Got exception when polling devices: ${e.stack}`)
    }
  })
}

const digestMessage = function (topic, message) {
  // log(`Digesting message for topic ${topic}: ${message}`);
  if (deviceStatesByTopic[topic] !== message) {
    log(`State was updated for ${topic}: ${message}. Sending to API.`)
    if (topic.endsWith(powerCommandTopicSuffix)) {
      const lastKnownState = deviceStatesByTopic[topic.replace(powerCommandTopicSuffix, stateTopicSuffix)]
      const updatedBit = bitwiseTurnPowerOnOrOffByState(lastKnownState, message)
      updateDeviceState(lastKnownState.id, updatedBit)
    }
  }
  deviceStatesByTopic[topic] = message
}

const app = express()
app.post('/getDevices', function (req, res) {
  handleGetDevicesState(res)
})
app.get('/getDevices', function (req, res) {
  handleGetDevicesState(res)
})

app.listen(3000, function () {
  log('Mindobridge listening on port 3000!')
  const client = mqtt.connect(`mqtt://${config.mqtt.host}`, { username: config.mqtt.username, password: config.mqtt.password, port: config.mqtt.port })

  client.on('connect', function () {
    log('Connected to MQTT!')
    bootstrapDevices(client)
    setInterval(pollAndUpdate, config.pollingInterval, client)
    client.publish('platform/mindobridge/status', 'READY')
  })

  client.on('message', function (topic, message) {
    // message is Buffer
    digestMessage(topic.toString(), message.toString())
  })
})
