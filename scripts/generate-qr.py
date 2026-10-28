"""
Minimal self-contained QR Code generator (no external dependencies).

Supports QR versions 4 and 5 at error-correction level M. This is enough for
the Docmac download URL while keeping the implementation auditable.

Usage:
    python scripts/generate-qr.py [url] [output.svg]
"""

import sys

# Galois field GF(256) with primitive polynomial 0x11d (285).
EXP = [0] * 512
LOG = [0] * 256
value = 1
for index in range(255):
    EXP[index] = value
    EXP[index + 255] = value
    LOG[value] = index
    value = (value << 1) ^ (285 if value & 0x80 else 0)

# Version 4 and 5, level M, two equally sized Reed-Solomon blocks.
VERSIONS = {
    4: {
        "size": 33,
        "total_codewords": 100,
        "data_codewords": 64,
        "ec_per_block": 18,
        "blocks": 2,
        "block_data": 32,
        "alignment": 26,
        "remainder_bits": 7,
    },
    5: {
        "size": 37,
        "total_codewords": 134,
        "data_codewords": 86,
        "ec_per_block": 24,
        "blocks": 2,
        "block_data": 43,
        "alignment": 30,
        "remainder_bits": 7,
    },
}


def gf_mul(x, y):
    if x == 0 or y == 0:
        return 0
    return EXP[LOG[x] + LOG[y]]


def rs_generator_poly(degree):
    generator = [1]
    for index in range(degree):
        root = EXP[index]
        next_generator = [0] * (len(generator) + 1)
        for position, coefficient in enumerate(generator):
            next_generator[position] ^= gf_mul(coefficient, root)
            next_generator[position + 1] ^= coefficient
        generator = next_generator
    return generator[::-1]


def rs_encode(data, num_ec):
    generator = rs_generator_poly(num_ec)
    message = list(data) + [0] * num_ec
    for index in range(len(data)):
        lead = message[index]
        if lead != 0:
            for offset in range(1, len(generator)):
                message[index + offset] ^= gf_mul(lead, generator[offset])
    return message[len(data):]


def choose_version(text):
    data = text.encode("utf-8")
    for version in sorted(VERSIONS):
        capacity = VERSIONS[version]["data_codewords"] - 2
        if len(data) <= capacity:
            return version
    raise ValueError(
        f"Text is too long for versions 4-5/M: {len(data)} bytes (max 84)"
    )


def encode_qr(text, version=None):
    data_bytes = text.encode("utf-8")
    if version is None:
        version = choose_version(text)
    spec = VERSIONS[version]
    capacity = spec["data_codewords"] - 2
    if len(data_bytes) > capacity:
        raise ValueError(
            f"Text too long for V{version}-M: {len(data_bytes)} bytes (max {capacity})"
        )

    bits = "0100"  # Byte mode
    bits += f"{len(data_bytes):08b}"  # 8-bit count for versions 1-9
    for byte in data_bytes:
        bits += f"{byte:08b}"

    capacity_bits = spec["data_codewords"] * 8
    bits += "0000"[: min(4, capacity_bits - len(bits))]
    if len(bits) % 8 != 0:
        bits += "0" * (8 - (len(bits) % 8))

    data_codewords = bytearray(
        int(bits[offset:offset + 8], 2) for offset in range(0, len(bits), 8)
    )
    pad_bytes = [0xEC, 0x11]
    pad_index = 0
    while len(data_codewords) < spec["data_codewords"]:
        data_codewords.append(pad_bytes[pad_index % 2])
        pad_index += 1

    blocks_data = [
        data_codewords[index * spec["block_data"] : (index + 1) * spec["block_data"]]
        for index in range(spec["blocks"])
    ]
    blocks_ec = [rs_encode(block, spec["ec_per_block"]) for block in blocks_data]

    final_codewords = []
    for index in range(spec["block_data"]):
        for block in blocks_data:
            final_codewords.append(block[index])
    for index in range(spec["ec_per_block"]):
        for block in blocks_ec:
            final_codewords.append(block[index])

    return "".join(f"{codeword:08b}" for codeword in final_codewords) + "0" * spec["remainder_bits"]


def create_matrix(version):
    spec = VERSIONS[version]
    size = spec["size"]
    matrix = [[None] * size for _ in range(size)]
    reserved = [[False] * size for _ in range(size)]

    def place_finder(row_start, column_start):
        for row in range(row_start, row_start + 7):
            for column in range(column_start, column_start + 7):
                delta_row = row - row_start
                delta_column = column - column_start
                is_black = (
                    delta_row in (0, 6)
                    or delta_column in (0, 6)
                    or (2 <= delta_row <= 4 and 2 <= delta_column <= 4)
                )
                matrix[row][column] = 1 if is_black else 0
                reserved[row][column] = True
        for row in range(max(0, row_start - 1), min(size, row_start + 8)):
            for column in range(max(0, column_start - 1), min(size, column_start + 8)):
                if not reserved[row][column]:
                    matrix[row][column] = 0
                    reserved[row][column] = True

    place_finder(0, 0)
    place_finder(0, size - 7)
    place_finder(size - 7, 0)

    for index in range(8, size - 8):
        matrix[6][index] = 1 if index % 2 == 0 else 0
        reserved[6][index] = True
        matrix[index][6] = 1 if index % 2 == 0 else 0
        reserved[index][6] = True

    center = spec["alignment"]
    for row in range(center - 2, center + 3):
        for column in range(center - 2, center + 3):
            delta_row = abs(row - center)
            delta_column = abs(column - center)
            matrix[row][column] = 1 if (delta_row == 2 or delta_column == 2 or (delta_row == 0 and delta_column == 0)) else 0
            reserved[row][column] = True

    matrix[size - 8][8] = 1
    reserved[size - 8][8] = True

    # Format information reserves.
    for index in range(9):
        reserved[8][index] = True
        reserved[index][8] = True
    for row in range(size - 7, size):
        reserved[row][8] = True
    for column in range(size - 8, size):
        reserved[8][column] = True

    return matrix, reserved


def apply_mask(matrix, reserved, mask_number):
    size = len(matrix)
    masked = [row[:] for row in matrix]
    for row in range(size):
        for column in range(size):
            if reserved[row][column]:
                continue
            invert = False
            if mask_number == 0:
                invert = (row + column) % 2 == 0
            elif mask_number == 1:
                invert = row % 2 == 0
            elif mask_number == 2:
                invert = column % 3 == 0
            elif mask_number == 3:
                invert = (row + column) % 3 == 0
            elif mask_number == 4:
                invert = ((row // 2) + (column // 3)) % 2 == 0
            elif mask_number == 5:
                invert = ((row * column) % 2) + ((row * column) % 3) == 0
            elif mask_number == 6:
                invert = (((row * column) % 2) + ((row * column) % 3)) % 2 == 0
            elif mask_number == 7:
                invert = (((row + column) % 2) + ((row * column) % 3)) % 2 == 0
            if invert:
                masked[row][column] = 1 if masked[row][column] == 0 else 0
    return masked


def set_format_info(matrix, ec_level_bits, mask_number):
    format_data = (int(ec_level_bits, 2) << 3) | mask_number
    value = format_data << 10
    polynomial = 0x537
    for index in range(4, -1, -1):
        if value & (1 << (index + 10)):
            value ^= polynomial << index
    format_code = ((format_data << 10) | value) ^ 0x5412
    size = len(matrix)

    for index in range(15):
        bit = (format_code >> index) & 1
        if index < 6:
            matrix[index][8] = bit
        elif index < 8:
            matrix[index + 1][8] = bit
        else:
            matrix[size - 15 + index][8] = bit

    for index in range(15):
        bit = (format_code >> index) & 1
        if index < 8:
            matrix[8][size - index - 1] = bit
        elif index < 9:
            matrix[8][15 - index] = bit
        else:
            matrix[8][15 - index - 1] = bit

    matrix[size - 8][8] = 1


def calculate_penalty(matrix):
    size = len(matrix)
    penalty = 0

    for row in range(size):
        run = 1
        for column in range(1, size):
            if matrix[row][column] == matrix[row][column - 1]:
                run += 1
            else:
                if run >= 5:
                    penalty += 3 + (run - 5)
                run = 1
        if run >= 5:
            penalty += 3 + (run - 5)

    for column in range(size):
        run = 1
        for row in range(1, size):
            if matrix[row][column] == matrix[row - 1][column]:
                run += 1
            else:
                if run >= 5:
                    penalty += 3 + (run - 5)
                run = 1
        if run >= 5:
            penalty += 3 + (run - 5)

    for row in range(size - 1):
        for column in range(size - 1):
            if (
                matrix[row][column]
                == matrix[row + 1][column]
                == matrix[row][column + 1]
                == matrix[row + 1][column + 1]
            ):
                penalty += 3

    pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    reverse_pattern = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    for row in range(size):
        for column in range(size - 10):
            window = [matrix[row][column + offset] for offset in range(11)]
            if window == pattern or window == reverse_pattern:
                penalty += 40
    for column in range(size):
        for row in range(size - 10):
            window = [matrix[row + offset][column] for offset in range(11)]
            if window == pattern or window == reverse_pattern:
                penalty += 40

    dark_count = sum(sum(row) for row in matrix)
    percent = (dark_count * 100) // (size * size)
    previous_five = (percent // 5) * 5
    next_five = previous_five + 5
    penalty += min(abs(previous_five - 50) // 5, abs(next_five - 50) // 5) * 10

    return penalty


def generate_qr(text, version=None):
    if version is None:
        version = choose_version(text)
    bits = encode_qr(text, version)
    matrix, reserved = create_matrix(version)
    size = len(matrix)

    bit_index = 0
    column = size - 1
    upwards = True
    while column > 0:
        if column == 6:
            column -= 1
        columns = [column, column - 1]
        rows = range(size - 1, -1, -1) if upwards else range(size)
        for row in rows:
            for current_column in columns:
                if not reserved[row][current_column]:
                    matrix[row][current_column] = int(bits[bit_index]) if bit_index < len(bits) else 0
                    bit_index += 1
        column -= 2
        upwards = not upwards

    best_matrix = None
    best_penalty = float("inf")
    for mask_number in range(8):
        candidate = apply_mask(matrix, reserved, mask_number)
        set_format_info(candidate, "00", mask_number)
        penalty = calculate_penalty(candidate)
        if penalty < best_penalty:
            best_penalty = penalty
            best_matrix = candidate

    return best_matrix


def matrix_to_svg(matrix, scale=6, margin=3):
    size = len(matrix)
    total_size = (size + margin * 2) * scale
    rectangles = []
    for row in range(size):
        for column in range(size):
            if matrix[row][column] == 1:
                x = (column + margin) * scale
                y = (row + margin) * scale
                rectangles.append(
                    f'<rect x="{x}" y="{y}" width="{scale}" height="{scale}" fill="#0a3d91" />'
                )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_size} {total_size}" width="{total_size}" height="{total_size}" role="img" aria-label="QR code to download Docmac on Android">
  <rect width="100%" height="100%" fill="#ffffff" rx="16" />
  {''.join(rectangles)}
</svg>'''


def verify_qr(matrix, expected_text):
    """Decode a generated matrix and verify format, Reed-Solomon, and payload."""
    size = len(matrix)
    version = (size - 17) // 4
    spec = VERSIONS[version]

    vertical_code = 0
    for index in range(15):
        if index < 6:
            bit = matrix[index][8]
        elif index < 8:
            bit = matrix[index + 1][8]
        else:
            bit = matrix[size - 15 + index][8]
        vertical_code |= bit << index

    horizontal_code = 0
    for index in range(15):
        if index < 8:
            bit = matrix[8][size - index - 1]
        elif index < 9:
            bit = matrix[8][15 - index]
        else:
            bit = matrix[8][15 - index - 1]
        horizontal_code |= bit << index

    if vertical_code != horizontal_code:
        raise ValueError(
            f"Format info mismatch: vertical {bin(vertical_code)} vs horizontal {bin(horizontal_code)}"
        )

    unmasked_format = vertical_code ^ 0x5412
    mask_number = (unmasked_format >> 10) & 0b111

    _, reserved = create_matrix(version)
    unmasked = apply_mask(matrix, reserved, mask_number)

    bits = []
    column = size - 1
    upwards = True
    while column > 0:
        if column == 6:
            column -= 1
        columns = [column, column - 1]
        rows = range(size - 1, -1, -1) if upwards else range(size)
        for row in rows:
            for current_column in columns:
                if not reserved[row][current_column]:
                    bits.append(unmasked[row][current_column])
        column -= 2
        upwards = not upwards

    codewords = []
    for index in range(spec["total_codewords"]):
        codeword = 0
        for bit_offset in range(8):
            codeword = (codeword << 1) | bits[index * 8 + bit_offset]
        codewords.append(codeword)

    data_codewords = spec["data_codewords"]
    ec_per_block = spec["ec_per_block"]
    blocks_data = [
        codewords[index:data_codewords:spec["blocks"]] for index in range(spec["blocks"])
    ]
    blocks_ec = [
        codewords[data_codewords + index : data_codewords + ec_per_block * spec["blocks"] : spec["blocks"]]
        for index in range(spec["blocks"])
    ]

    def poly_eval(polynomial, x):
        result = 0
        for coefficient in polynomial:
            result = gf_mul(result, x) ^ coefficient
        return result

    for index, (block_data, block_ec) in enumerate(zip(blocks_data, blocks_ec)):
        block = block_data + block_ec
        syndromes = [poly_eval(block, EXP[offset]) for offset in range(ec_per_block)]
        if not all(syndrome == 0 for syndrome in syndromes):
            raise ValueError(f"RS Block {index + 1} syndrome error: {syndromes}")

    all_data = [codeword for block in blocks_data for codeword in block]
    data_bits = "".join(f"{codeword:08b}" for codeword in all_data)
    mode = data_bits[:4]
    if mode != "0100":
        raise ValueError(f"Unexpected QR mode indicator: {mode}")
    length = int(data_bits[4:12], 2)
    payload_bytes = [
        int(data_bits[12 + index * 8 : 12 + (index + 1) * 8], 2)
        for index in range(length)
    ]
    decoded = bytes(payload_bytes).decode("utf-8")
    if decoded != expected_text:
        raise ValueError(f"Decoded text '{decoded}' does not match expected '{expected_text}'")
    return True


if __name__ == "__main__":
    url = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "https://github.com/jackbarisere8/DOCMAC/releases/latest/download/app-release.apk"
    )
    out_file = sys.argv[2] if len(sys.argv) > 2 else "assets/images/qr-download.svg"
    version = choose_version(url)
    matrix = generate_qr(url, version)
    verify_qr(matrix, url)
    svg_content = matrix_to_svg(matrix)
    with open(out_file, "w", encoding="utf-8") as output:
        output.write(svg_content)
    print(
        f"Generated and verified {out_file} for {url} "
        f"(V{version}-M, {len(matrix)}x{len(matrix)} matrix)"
    )
