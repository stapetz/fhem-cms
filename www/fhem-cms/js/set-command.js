const SET_COMMAND_PATTERN = /^[A-Za-z0-9_.-]{1,128}(?: [A-Za-z0-9_.:+,/%=-]{1,128})*(?![\s\S])/;

export function isValidSetCommand(command) {
  return typeof command === 'string'
    && command.length <= 512
    && SET_COMMAND_PATTERN.test(command);
}
