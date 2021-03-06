const powerTopicSuffix = 'POWER'
const powerCommandTopicSuffix = 'CMND/POWER'
const stateTopicSuffix = 'STATE'

const TOPICS_BY_DEVICE_TYPE = {
  OnOffSwitch: { type: 'light' },
  Sensor: { type: 'sensor' },
  Plug: { type: 'switch' },
  Boiler: { type: 'switch' }
}

function getBit (number, bitPosition) {
  return (number & (1 << bitPosition)) === 0 ? 0 : 1
}

function setBit (number, bitPosition) {
  return number | (1 << bitPosition)
}

function clearBit (number, bitPosition) {
  const mask = ~(1 << bitPosition)
  return number & mask
}

/* function updateBit (number, bitPosition, bitValue) {
  const bitValueNormalized = bitValue ? 1 : 0
  const clearMask = ~(1 << bitPosition)
  return (number & clearMask) | (bitValueNormalized << bitPosition)
} */

const safeDeviceName = function (input) {
  return (input || '').trim().toLowerCase().replace('_', ' ').replace('-', ' ').replace(' ', '-')
}

const parseBitState = function (state) {
  const bitValue = state.state
  const deviceModes = TOPICS_BY_DEVICE_TYPE[state.type]
  if (!deviceModes) { return 'INVALID' }

  if (getBit(bitValue, 1) === 0) {
    return 'OFF'
  } else if (getBit(bitValue, 1) === 1) {
    return 'ON'
  }
  return 'UNKNOWN'
}

const parseStateTopic = function (deviceState) {
  return {
    id: deviceState.id,
    connectivityRate: deviceState.connectivityRate,
    signalStrength: deviceState.signalStrength,
    friendlyName: deviceState.name,
    bitState: deviceState.state,
    state: parseBitState(deviceState)
  }
}

const parsePowerTopic = function (deviceState) {
  return parseBitState(deviceState)
}

const parseTopicsFromDevice = function (topicPrefix, device) {
  const retVal = {}
  const deviceType = Object.keys(device)[0]
  const deviceTopicType = (TOPICS_BY_DEVICE_TYPE[deviceType] || {}).type || 'generic-device'
  const currentState = device[deviceType][0]
  const deviceTopicPrefix = `${topicPrefix}/${deviceTopicType}/${safeDeviceName(currentState.name)}`
  const powerTopicKey = `${deviceTopicPrefix}/${powerTopicSuffix}`
  const stateTopicKey = `${deviceTopicPrefix}/${stateTopicSuffix}`
  retVal[powerTopicKey] = parsePowerTopic(currentState)
  retVal[stateTopicKey] = parseStateTopic(currentState)
  return retVal
}

const bitwiseTurnPowerOnOrOffByState = function (currentState, message) {
  const lastKnownBitwiseState = currentState.bitState
  if (message === 'ON') {
    return setBit(lastKnownBitwiseState, 1)
  } else if (message === 'OFF') {
    return clearBit(lastKnownBitwiseState, 1)
  }
  return lastKnownBitwiseState
}

module.exports = {
  parseTopicsFromDevice,
  powerTopicSuffix,
  powerCommandTopicSuffix,
  stateTopicSuffix,
  bitwiseTurnPowerOnOrOffByState
}
