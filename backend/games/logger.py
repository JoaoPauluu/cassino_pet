import logging

# Create a logger specific to this module


def logger_exists(name):
    # Check if the name is in the internal manager dictionary
    return name in logging.Logger.manager.loggerDict

def get_logger(game: str) -> logging.Logger:
    if logger_exists(game):
        return logging.getLogger(game)
    
    logger = logging.getLogger(game)
    logger.setLevel(logging.INFO)

    # Create a handler (e.g., console handler)
    c_handler = logging.StreamHandler()

    # Create a formatter and add it to the handler
    formatter = logging.Formatter('[%(name)s] - [%(levelname)s] - %(message)s')
    c_handler.setFormatter(formatter)

    # Add the handler to the logger
    logger.addHandler(c_handler)

    return logger
