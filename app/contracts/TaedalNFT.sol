// app/contracts/TaedalNFT.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract Counter {
    uint256 internal _counter;
    function _nextId() internal returns (uint256 id) { unchecked { id = ++_counter; } }
    function currentId() public view returns (uint256) { return _counter; }
}

contract TaedalNFT is ERC721URIStorage, Ownable, Counter {
    constructor() ERC721("Taedal", "TAEDAL") Ownable(msg.sender) {}

    // owner-only (kept for you)
    function safeMint(address to, string memory uri) external onlyOwner {
        uint256 tokenId = _nextId();
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    // public mint (any EOA)
    function publicMint(string memory uri) external {
        uint256 tokenId = _nextId();
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
